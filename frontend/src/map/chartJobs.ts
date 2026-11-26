// 航海图重活的调度：优先交给后台线程（chart.worker.ts），没有 Worker 或后台线程出错时改在主线程空闲时计算。
// - chart(season)：要显示的季节。结果缓存；显示后顺手预先生成下一季，季节切换时直接换图，不再整图重算。
// - fog(rows)：迷雾更新（经典世界的整张文本）。计算中又来了新的，只保留最新一份（中间的跳过——迷雾按与上一次的差异重画，结果相同）。
// - fogSync(bits) / fogRuns(runs)（性能商议 2026-10-07）：大地图的迷雾直接给位图（全量重同步）或 fog_delta 的区间（增量），
//   不再转成整张文本；计算中排着的区间合并成一份，全量盖掉排着的一切。后台线程按变化聚块局部重画，变化的几块各回调一次。
// - tile(season, tx, ty)（第九批）：航行视图的一块瓦片（64 × 64 格、每格 12 像素、盖好迷雾）；同一块在路上时不重复请求。
// 大地图（opts.scale = 2）的世界图与迷雾矩形都是每格 2 像素（见 chartWork.ts）；大地图不预先生成下一季（省内存）。
// 内存账本（map/memory.ts）：给了 opts.ledgerKey 时，后台线程（或主线程后备）持有的字节记在 `${键}:worker`、
// 主线程缓存的世界图记在 `${键}:world`；destroy 时清掉这张图的账，主线程后备的整图、迷雾与记忆化缓存里的海图一并释放。
import type { ChartInput } from "../art/map";
import { ChartWorkState, type ChartRequest, type ChartResponse, type FogCells, type FogPart, type RgbaImage } from "./chartWork";
import { FogBits, type FogRun } from "./fogBits";
import { account, dropAccounts } from "./memory";
import { tileKey } from "./tiles";

export interface ChartJobHandlers {
  /** 要显示的季节的整张海图就绪。 */
  chart: (season: number, img: RgbaImage) => void;
  /** 迷雾变化的矩形（null 表示没有变化）；cells 为变化涉及的格（航行视图据此作废瓦片）。 */
  fog: (img: RgbaImage | null, cells?: FogCells) => void;
  /** 航行视图的瓦片就绪。 */
  tile?: (season: number, tx: number, ty: number, img: RgbaImage) => void;
  /** 细节瓦片的地形就绪（没有细图层的地图为 null）。 */
  detail?: (season: number, tx: number, ty: number, img: RgbaImage | null) => void;
  /** 细节瓦片的迷雾就绪（这一块没有未探明的格为 null）。 */
  fogTile?: (tx: number, ty: number, img: RgbaImage | null) => void;
  /** 高清瓦片（H10c）的迷雾就绪（这一块没有未探明的格为 null）。 */
  hdFog?: (tx: number, ty: number, k: number, img: RgbaImage | null) => void;
}

export interface ChartJobs {
  /** 请求显示某个季节的海图（0 春 1 夏 2 秋 3 冬）。已缓存时立即回调。 */
  chart: (season: number) => void;
  /** 更新迷雾（每行一个字符串，'1' 为已揭开）。 */
  fog: (rows: string[]) => void;
  /** 大地图：整张换上这份位图（全量重同步；会复制一份，之后改动原位图不影响）。 */
  fogSync: (bits: FogBits) => void;
  /** 大地图：fog_delta 的区间（新揭开的格），接在上一次 fogSync / fogRuns 之后。 */
  fogRuns: (runs: readonly FogRun[]) => void;
  /** 请求航行视图的一块瓦片（同一块在路上时忽略）。 */
  tile: (season: number, tx: number, ty: number) => void;
  /** 请求一块细节瓦片的地形（M01；同一块在路上时忽略）。 */
  detail: (season: number, tx: number, ty: number) => void;
  /** 请求一块细节瓦片的迷雾（同一块在路上时忽略）；照当时已经交给这里的迷雾算。 */
  fogTile: (tx: number, ty: number) => void;
  /** 请求一块高清瓦片（H10c）的迷雾（同一块同一精度在路上时忽略）；照当时已经交给这里的迷雾算。 */
  hdFog: (tx: number, ty: number, k: number) => void;
  /** 再要一次整张迷雾（后来的使用者没赶上第一次的整张图时）；还没有迷雾时什么也不做。 */
  fogFull: () => void;
  destroy: () => void;
}

const norm = (s: number) => ((Math.trunc(s) % 4) + 4) % 4;

/** 迷雾队列里的一项：经典世界的整张文本、大地图的位图全量或区间。 */
type FogOp = { kind: "rows"; rows: string[] } | { kind: "sync"; bits: Uint8Array } | { kind: "runs"; runs: FogRun[] };

/** 主线程空闲时执行（没有 requestIdleCallback 时下一轮事件循环执行）；返回取消函数。 */
function whenIdle(fn: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(fn, { timeout: 400 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 0);
  return () => clearTimeout(id);
}

function spawnWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker(new URL("./chart.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
}

/** 创建海图的计算调度。worker 为 false 时只用主线程（测试用）；scale 为世界图的缩小倍数（大地图 2）。 */
export function createChartJobs(
  input: ChartInput,
  handlers: ChartJobHandlers,
  opts: { worker?: boolean; scale?: 1 | 2; ledgerKey?: string } = {},
): ChartJobs {
  const scale = opts.scale ?? 1;
  const ledger = opts.ledgerKey;
  /** 记下后台线程（或主线程后备）持有的字节 */
  const noteHeld = (held: number | undefined) => {
    if (ledger !== undefined && held !== undefined && !destroyed) account(`${ledger}:worker`, held);
  };
  /** 记下主线程缓存的世界图 */
  const noteWorld = () => {
    if (ledger === undefined || destroyed) return;
    let n = 0;
    for (const img of cache.values()) n += img.data.byteLength;
    account(`${ledger}:world`, n);
  };
  let destroyed = false;
  let worker = opts.worker === false ? null : spawnWorker();
  /** 主线程后备的全部状态（第一次用到时才创建） */
  let local: ChartWorkState | null = null;
  const localState = () => (local ??= new ChartWorkState(input, scale));
  const cancels = new Set<() => void>();

  let want: number | null = null;
  const cache = new Map<number, RgbaImage>();
  const inflight = new Set<number>();
  let fogBusy = false;
  /** 排着的迷雾：整张文本（经典）、位图全量（自己的一份拷贝）或合并好的区间 */
  let fogPending: FogOp | null = null;
  /** 迷雾的全部现状（后台线程出错时在主线程从头重算）：经典世界的文本，或大地图的位图（随区间更新） */
  let fogLast: string[] | null = null;
  let fogMirror: FogBits | null = null;
  /** 在路上的瓦片（键 → 参数） */
  const tilesInflight = new Map<string, [number, number, number]>();
  /** 在路上的细节瓦片：地形（键 → 季节与编号）与迷雾（键 → 编号） */
  const detailInflight = new Map<string, [number, number, number]>();
  const fogTilesInflight = new Map<string, [number, number]>();
  const hdFogInflight = new Map<string, [number, number, number]>();

  /** 只缓存要显示的季节与它的下一季（大地图只缓存要显示的一季）。 */
  const keep = (season: number) => want !== null && (season === want || (scale === 1 && season === norm(want + 1)));
  const trim = () => {
    for (const k of [...cache.keys()]) if (!keep(k)) cache.delete(k);
    noteWorld();
  };
  const idle = (fn: () => void) => {
    const cancel = whenIdle(() => {
      cancels.delete(cancel);
      if (!destroyed) fn();
    });
    cancels.add(cancel);
  };

  const onChart = (season: number, img: RgbaImage) => {
    inflight.delete(season);
    if (destroyed) return;
    if (keep(season)) {
      cache.set(season, img);
      noteWorld();
    }
    if (season === want) {
      handlers.chart(season, img);
      prefetch();
    }
  };
  const onFog = (img: RgbaImage | null, cells?: FogCells) => {
    fogBusy = false;
    if (destroyed) return;
    handlers.fog(img, cells);
    next();
  };
  /** fogSync / fogRuns 的回复：变化的几块各回调一次（没有变化时回调一次 null，与文本的“没有变化”相同）。 */
  const onFogParts = (parts: FogPart[]) => {
    fogBusy = false;
    if (destroyed) return;
    if (parts.length === 0) handlers.fog(null, null);
    for (const p of parts) handlers.fog(p.img, p.cells);
    next();
  };
  const next = () => {
    if (!fogPending) return;
    const op = fogPending;
    fogPending = null;
    sendOp(op);
  };
  const onTile = (season: number, tx: number, ty: number, img: RgbaImage) => {
    tilesInflight.delete(tileKey(season, tx, ty));
    if (destroyed) return;
    handlers.tile?.(season, tx, ty, img);
  };

  const runChart = (season: number, background: boolean) => {
    if (inflight.has(season) || cache.has(season)) return;
    if (worker) {
      inflight.add(season);
      worker.postMessage({ kind: "chart", season } satisfies ChartRequest);
      return;
    }
    // 主线程后备：预先生成下一季只在浏览器报告空闲时做，免得在不合适的时候卡一下
    if (background && typeof requestIdleCallback !== "function") return;
    inflight.add(season);
    idle(() => {
      const st = localState();
      const img = st.chart(season);
      noteHeld(st.heldBytes());
      onChart(season, img);
    });
  };
  const prefetch = () => {
    if (want !== null && scale === 1) runChart(norm(want + 1), true);
  };

  const sendFog = (rows: string[]) => {
    fogBusy = true;
    fogLast = rows;
    if (worker) {
      worker.postMessage({ kind: "fog", rows } satisfies ChartRequest);
      return;
    }
    idle(() => {
      const st = localState();
      const img = st.fogUpdate(rows);
      noteHeld(st.heldBytes());
      onFog(img, st.fog.lastCells);
    });
  };
  const sendOp = (op: FogOp) => {
    if (op.kind === "rows") {
      sendFog(op.rows);
      return;
    }
    fogBusy = true;
    if (worker) {
      if (op.kind === "sync") worker.postMessage({ kind: "fogSync", bits: op.bits } satisfies ChartRequest, [op.bits.buffer]);
      else worker.postMessage({ kind: "fogRuns", runs: op.runs } satisfies ChartRequest);
      return;
    }
    idle(() => {
      const st = localState();
      const parts = op.kind === "sync" ? st.fogSync(op.bits) : st.fogRuns(op.runs);
      noteHeld(st.heldBytes());
      onFogParts(parts);
    });
  };
  /** 排进迷雾的队列：全量盖掉排着的；区间并进排着的区间，或直接揭开排着的位图。 */
  const queueFog = (op: FogOp) => {
    if (!fogBusy) {
      sendOp(op);
      return;
    }
    if (op.kind !== "runs" || !fogPending) fogPending = op;
    else if (fogPending.kind === "runs") fogPending = { kind: "runs", runs: [...fogPending.runs, ...op.runs] };
    else if (fogPending.kind === "sync") {
      const b = new FogBits(input.width, input.height, fogPending.bits);
      b.applyRuns(op.runs);
      fogPending = { kind: "sync", bits: b.bits };
    } else fogPending = op;
  };

  const sendTile = (season: number, tx: number, ty: number) => {
    if (worker) {
      worker.postMessage({ kind: "tile", season, tx, ty } satisfies ChartRequest);
      return;
    }
    idle(() => onTile(season, tx, ty, localState().tile(season, tx, ty)));
  };
  const onDetail = (season: number, tx: number, ty: number, img: RgbaImage | null) => {
    detailInflight.delete(tileKey(season, tx, ty));
    if (!destroyed) handlers.detail?.(season, tx, ty, img);
  };
  const onFogTile = (tx: number, ty: number, img: RgbaImage | null) => {
    fogTilesInflight.delete(`${tx}:${ty}`);
    if (!destroyed) handlers.fogTile?.(tx, ty, img);
  };
  const sendDetail = (season: number, tx: number, ty: number) => {
    if (worker) {
      worker.postMessage({ kind: "detail", season, tx, ty } satisfies ChartRequest);
      return;
    }
    idle(() => onDetail(season, tx, ty, localState().detailTile(season, tx, ty)));
  };
  const onHdFog = (tx: number, ty: number, k: number, img: RgbaImage | null) => {
    hdFogInflight.delete(`${k}:${tx}:${ty}`);
    if (!destroyed) handlers.hdFog?.(tx, ty, k, img);
  };
  const sendHdFog = (tx: number, ty: number, k: number) => {
    if (worker) {
      worker.postMessage({ kind: "hdFog", tx, ty, k } satisfies ChartRequest);
      return;
    }
    idle(() => onHdFog(tx, ty, k, localState().hdFogTile(tx, ty, k)));
  };
  const sendFogTile = (tx: number, ty: number) => {
    if (worker) {
      worker.postMessage({ kind: "fogTile", tx, ty } satisfies ChartRequest);
      return;
    }
    idle(() => onFogTile(tx, ty, localState().fogTile(tx, ty)));
  };

  /** 后台线程不可用：改在主线程计算，重发还没完成的请求（主线程的迷雾画家从头画一张整图）。 */
  const fallback = () => {
    worker?.terminate();
    worker = null;
    if (destroyed) return;
    const pending = [...inflight];
    inflight.clear();
    for (const s of pending) runChart(s, s !== want);
    if (fogBusy || fogLast || fogMirror) {
      fogBusy = false;
      fogPending = null;
      // 主线程的画家从头画：给全部现状
      if (fogMirror) sendOp({ kind: "sync", bits: fogMirror.bits.slice() });
      else if (fogLast) sendFog(fogLast);
    }
    for (const [season, tx, ty] of tilesInflight.values()) sendTile(season, tx, ty);
    for (const [season, tx, ty] of detailInflight.values()) sendDetail(season, tx, ty);
    for (const [tx, ty] of fogTilesInflight.values()) sendFogTile(tx, ty);
    for (const [tx, ty, k] of hdFogInflight.values()) sendHdFog(tx, ty, k);
  };

  if (worker) {
    worker.onmessage = (e: MessageEvent<ChartResponse>) => {
      const m = e.data;
      if (m.kind === "chart" || m.kind === "fog" || m.kind === "fogParts") noteHeld(m.held);
      if (m.kind === "chart") onChart(m.season, m.img);
      else if (m.kind === "fog") {
        // 整张迷雾的补发（fogFull）不占迷雾的队列
        if (m.full) {
          if (m.img && !destroyed) handlers.fog(m.img, "all");
        } else onFog(m.img, m.cells);
      } else if (m.kind === "fogParts") onFogParts(m.parts);
      else if (m.kind === "tile") onTile(m.season, m.tx, m.ty, m.img);
      else if (m.kind === "detail") onDetail(m.season, m.tx, m.ty, m.img);
      else if (m.kind === "fogTile") onFogTile(m.tx, m.ty, m.img);
      else if (m.kind === "hdFog") onHdFog(m.tx, m.ty, m.k, m.img);
      else fallback();
    };
    worker.onerror = (e) => {
      e.preventDefault();
      fallback();
    };
    worker.postMessage({ kind: "init", input, scale } satisfies ChartRequest);
  }

  return {
    chart(season) {
      want = norm(season);
      trim();
      const hit = cache.get(want);
      if (hit) {
        handlers.chart(want, hit);
        prefetch();
        return;
      }
      runChart(want, false);
    },
    fog(rows) {
      if (destroyed) return;
      fogMirror = null;
      queueFog({ kind: "rows", rows });
    },
    fogSync(bits) {
      if (destroyed) return;
      fogLast = null;
      fogMirror = new FogBits(bits.width, bits.height, bits.bits);
      queueFog({ kind: "sync", bits: bits.bits.slice() });
    },
    fogRuns(runs) {
      if (destroyed || runs.length === 0) return;
      fogMirror?.applyRuns(runs);
      queueFog({ kind: "runs", runs: [...runs] });
    },
    fogFull() {
      // 迷雾计算中：算完时那一份会发给所有人，之后再补一张整图
      if (fogLast === null && fogMirror === null) return;
      if (worker) {
        worker.postMessage({ kind: "fogFull" } satisfies ChartRequest);
        return;
      }
      idle(() => {
        const img = localState().fogFull();
        if (img && !destroyed) handlers.fog(img, "all");
      });
    },
    tile(season, tx, ty) {
      const s = norm(season);
      const key = tileKey(s, tx, ty);
      if (tilesInflight.has(key)) return;
      tilesInflight.set(key, [s, tx, ty]);
      sendTile(s, tx, ty);
    },
    detail(season, tx, ty) {
      if (destroyed) return;
      const s = norm(season);
      const key = tileKey(s, tx, ty);
      if (detailInflight.has(key)) return;
      detailInflight.set(key, [s, tx, ty]);
      sendDetail(s, tx, ty);
    },
    fogTile(tx, ty) {
      if (destroyed) return;
      const key = `${tx}:${ty}`;
      if (fogTilesInflight.has(key)) return;
      fogTilesInflight.set(key, [tx, ty]);
      sendFogTile(tx, ty);
    },
    hdFog(tx, ty, k) {
      if (destroyed) return;
      const key = `${k}:${tx}:${ty}`;
      if (hdFogInflight.has(key)) return;
      hdFogInflight.set(key, [tx, ty, k]);
      sendHdFog(tx, ty, k);
    },
    destroy() {
      destroyed = true;
      worker?.terminate();
      worker = null;
      for (const c of cancels) c();
      cancels.clear();
      cache.clear();
      tilesInflight.clear();
      detailInflight.clear();
      fogTilesInflight.clear();
      hdFogInflight.clear();
      fogPending = null;
      fogLast = null;
      fogMirror = null;
      // 后台线程结束时它的内存整个释放；主线程后备要自己放手（整图、迷雾与记忆化缓存里这张图的海图、云团毯）
      local?.release();
      local = null;
      if (ledger !== undefined) dropAccounts(`${ledger}:`);
    },
  };
}
