// 高清海图瓦片（H10c）的线程池与调度：航行画面每帧报一份“想要的瓦片”（按先后：视野里的低清垫底 → 视野里的高清 →
// 视野外一圈），这里只把还没画、也不在路上的排进队，空着的线程按队头取活；队伍每次整份换掉——镜头走开了，
// 远处还没开始画的就不画了。同一张海图（同一个键）的线程池共用，最后一个使用者放手 30 秒后才关（来回进出航行画面不必重建）。
// 没有 Worker（测试环境）或线程出错时改在主线程空闲时一块一块地画。
import type { ChartInput } from "../art/map";
import { hdContext, paintHdTile, type HdContext, type HdImage } from "../art/map/hd";

/** 一块要画的高清瓦片。 */
export interface HdTileRequest {
  key: string;
  season: number;
  tx: number;
  ty: number;
  /** 每细格的像素：4 正式、1 低清垫底 */
  k: number;
}

/** 画好的一块：位图（后台线程转好的 ImageBitmap）或 RGBA（主线程后备、或线程里转不了位图时）。 */
export interface HdTileResult {
  req: HdTileRequest;
  w: number;
  h: number;
  bitmap: ImageBitmap | null;
  rgba: Uint8ClampedArray<ArrayBuffer> | null;
  /** 生成耗时（毫秒；后台线程里量的） */
  ms: number;
}

export type HdWorkerRequest = { kind: "init"; input: ChartInput } | ({ kind: "tile" } & HdTileRequest);
export type HdWorkerResponse =
  | { kind: "tile"; key: string; img: Omit<HdImage, "data"> & { data: Uint8ClampedArray<ArrayBuffer> | null }; bitmap: ImageBitmap | null; ms: number }
  | { kind: "tile"; key: string; img: null; bitmap: null; ms: number }
  | { kind: "error"; key?: string; message: string };

/** 瓦片的键：精度、季节、编号。 */
export function hdTileKey(k: number, season: number, tx: number, ty: number): string {
  return `${k}:${season}:${tx}:${ty}`;
}

export interface HdPool {
  /** 换上一份想要的瓦片（按优先顺序；已经在画的不重复派）。 */
  want: (list: readonly HdTileRequest[]) => void;
  /** 订阅画好的瓦片；返回退订。 */
  subscribe: (fn: (r: HdTileResult) => void) => () => void;
  /** 线程数（0 为主线程后备） */
  readonly threads: number;
  /** 用完了（引用计数归零 30 秒后真正关掉） */
  release: () => void;
}

interface PoolState extends HdPool {
  refs: number;
  closeTimer: ReturnType<typeof setTimeout> | null;
  destroy: () => void;
}

const pools = new Map<string, PoolState>();

/** 线程数：逻辑核的一半，夹在 2–6 之间。 */
function threadCount(): number {
  const n = typeof navigator !== "undefined" && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  return Math.max(2, Math.min(6, Math.floor(n / 2)));
}

function spawn(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker(new URL("./hd.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
}

/** 主线程空闲时执行（没有 requestIdleCallback 时下一轮事件循环）。 */
function whenIdle(fn: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(fn, { timeout: 200 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 0);
  return () => clearTimeout(id);
}

function createPool(key: string, input: ChartInput, opts: { workers?: boolean }): PoolState {
  const listeners = new Set<(r: HdTileResult) => void>();
  let pending: HdTileRequest[] = [];
  const inflight = new Map<string, number>();
  let workers: (Worker | null)[] = [];
  const idle: number[] = [];
  let destroyed = false;
  // 主线程后备
  let local: HdContext | null | undefined;
  let localCancel: (() => void) | null = null;

  const emit = (r: HdTileResult) => {
    for (const l of listeners) l(r);
  };

  const pumpLocal = () => {
    if (localCancel || destroyed) return;
    const req = pending.shift();
    if (!req) return;
    inflight.set(req.key, -1);
    localCancel = whenIdle(() => {
      localCancel = null;
      inflight.delete(req.key);
      if (destroyed) return;
      if (local === undefined) local = hdContext(input);
      if (local) {
        const at = performance.now();
        const img = paintHdTile(local, req.season, req.tx, req.ty, req.k);
        emit({ req, w: img.w, h: img.h, bitmap: null, rgba: img.data, ms: performance.now() - at });
      }
      pumpLocal();
    });
  };

  const byKey = new Map<string, HdTileRequest>();
  const pump = () => {
    if (destroyed) return;
    if (workers.length === 0) {
      pumpLocal();
      return;
    }
    while (idle.length > 0 && pending.length > 0) {
      const req = pending.shift() as HdTileRequest;
      if (inflight.has(req.key)) continue;
      const w = idle.pop() as number;
      inflight.set(req.key, w);
      byKey.set(req.key, req);
      workers[w]?.postMessage({ kind: "tile", ...req } satisfies HdWorkerRequest);
    }
  };

  /** 线程不可用：全部关掉，在路上的重新排到队头，改在主线程画。 */
  const fallback = () => {
    for (const w of workers) w?.terminate();
    workers = [];
    idle.length = 0;
    const back = [...inflight.keys()].map((k) => byKey.get(k)).filter((r): r is HdTileRequest => !!r);
    inflight.clear();
    byKey.clear();
    pending = [...back, ...pending];
    pump();
  };

  if (opts.workers !== false) {
    const n = threadCount();
    for (let i = 0; i < n; i++) {
      const w = spawn();
      if (!w) break;
      workers.push(w);
      idle.push(i);
      w.onmessage = (e: MessageEvent<HdWorkerResponse>) => {
        const m = e.data;
        if (m.kind === "error") {
          fallback();
          return;
        }
        const req = byKey.get(m.key);
        inflight.delete(m.key);
        byKey.delete(m.key);
        idle.push(i);
        if (!destroyed && req && m.img) emit({ req, w: m.img.w, h: m.img.h, bitmap: m.bitmap, rgba: m.img.data, ms: m.ms });
        else m.bitmap?.close();
        pump();
      };
      w.onerror = (e) => {
        e.preventDefault();
        fallback();
      };
      w.postMessage({ kind: "init", input } satisfies HdWorkerRequest);
    }
  }

  const pool: PoolState = {
    refs: 1,
    closeTimer: null,
    get threads() {
      return workers.length;
    },
    want(list) {
      if (destroyed) return;
      pending = list.filter((r) => !inflight.has(r.key));
      pump();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    release() {
      pool.refs--;
      if (pool.refs > 0) return;
      // 不再要任何瓦片；30 秒内没人再用就关掉
      pending = [];
      pool.closeTimer = setTimeout(() => {
        if (pool.refs <= 0) pool.destroy();
      }, 30_000);
    },
    destroy() {
      destroyed = true;
      for (const w of workers) w?.terminate();
      workers = [];
      localCancel?.();
      localCancel = null;
      listeners.clear();
      pending = [];
      inflight.clear();
      byKey.clear();
      local = undefined;
      pools.delete(key);
    },
  };
  return pool;
}

/**
 * 取得（必要时创建）一张海图的高清瓦片线程池。key 与海图的计算中心同一个（chartHub 的键）。
 * opts.workers 为 false 时只用主线程（测试用）。
 */
export function acquireHdPool(key: string, input: ChartInput, opts: { workers?: boolean } = {}): HdPool {
  const found = pools.get(key);
  if (found) {
    found.refs++;
    if (found.closeTimer) {
      clearTimeout(found.closeTimer);
      found.closeTimer = null;
    }
    return found;
  }
  const pool = createPool(key, input, opts);
  pools.set(key, pool);
  return pool;
}
