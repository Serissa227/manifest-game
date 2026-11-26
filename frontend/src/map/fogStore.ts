// 航海图的迷雾（全局一份）：经典世界照旧取 fog() 的整张 '0' / '1' 文本；第九批的大地图（StaticView.map.external）
// 用 fog_delta 的位图增量（FogBits）。航海图（MapView）与航行视图共用。
// 请求按顺序一个接一个地发：每次的 since 都是手上最新的版本，迟到的结果不会把迷雾拨回去。
//
// 性能商议（2026-10-07）：大地图的迷雾不再转成整张文本——后台线程（共用的 chartHub）由 attachFogFeed 喂：
// 跟得上的话只给这一次的区间（fogRuns），跟不上（后来才订阅、换了地图、整张替换）时给整张位图（fogSync，全量重同步）。
// 地点列表、地点标记、航行视图要问“这一格揭开了没有”时用 fogLookup（位图直接查，不建文本）。
//
// P03：每个请求发出时记下本地请求序号（ipc/sequence.ts）；回来时序号变了（新开局、读档、换世界、重连）就不采用，按新序号重问
// （游标仍是手上的 epoch + rev：换了一局后端按 epoch 给全量）。事件连接被服务端以 1013 关闭、重连成功后（reason 为 "resync"）
// 从头取一次完整的迷雾：fog_delta 的 since 为 0、epoch 为空，后端给全量位图，整张替换手上的。
import { create } from "zustand";
import { navApi } from "../ipc/api";
import { onRequestSeq, requestSeq } from "../ipc/sequence";
import type { StaticView } from "../ipc/types";
import type { ChartHub } from "./chartHub";
import { applyFogDelta, type CellBox, type FogBits, type FogRun, type FogState } from "./fogBits";

export interface ChartFogStore {
  /** 这份迷雾属于哪张地图（fogMapKey）；换了地图就从头取 */
  map: string | null;
  state: FogState | null;
  /** 经典世界的整张文本（fog() 的结果）；大地图为 null（不建文本） */
  rows: string[] | null;
  /** 最近一次变化涉及的格（"all" 为整张） */
  changed: CellBox | "all" | null;
  /** 变化的序号：迷雾每变一次（整张或增量）换一个更大的数（全局递增，清空后也不回头） */
  seq: number;
  /** 最近一次变化的区间（相对上一个序号）；整张替换、经典的文本为 null */
  runs: readonly FogRun[] | null;
}

export const useChartFog = create<ChartFogStore>(() => ({ map: null, state: null, rows: null, changed: null, seq: 0, runs: null }));

/** 全局递增的变化序号 */
let seqNo = 0;

/** 迷雾属于哪张地图：数据、地图 key 与 hash（航海图与航行视图按同一个键）。 */
export function fogMapKey(statics: Pick<StaticView, "data_hash" | "map">): string {
  return `${statics.data_hash}:${statics.map.key ?? ""}:${statics.map.hash ?? ""}`;
}

/** 在路上的一次与排着的一次（其间再来的请求都并进排着的那一次：高倍速时迷雾版本每天都变，请求不越堆越多）。 */
let running: Promise<boolean> | null = null;
let queued: Promise<boolean> | null = null;
/** 排着的那一次用最近一次给的地图参数 */
let latest: { map: string; width: number; height: number } = { map: "", width: 0, height: 0 };

/** 下一次从头取（since 0、epoch 空）：1013 重连之后置位，取到全量并应用之后清掉 */
let fromScratch = false;

/** 序号对不上时最多重问几次（每次都是序号变了：连续换局很少见，不无限追下去） */
const FOG_RETRIES = 2;

async function fetchDelta(): Promise<boolean> {
  for (let attempt = 0; attempt <= FOG_RETRIES; attempt++) {
    const { map, width, height } = latest;
    const seq = requestSeq();
    const full = fromScratch;
    const cur = useChartFog.getState();
    const mine = cur.map === map ? cur.state : null;
    // 游标 = 哪一局（epoch）+ 哪个版本（rev）：换了一局、读了档时后端按 epoch 给全量（UI-CONTRACT I3）；从头取时不带游标
    const d = await navApi.fogDelta(full ? 0 : (mine?.rev ?? 0), full ? null : (mine?.epoch ?? null));
    // 等待期间换了一局或重连了：这份不是现在的，丢掉重问
    if (seq !== requestSeq()) continue;
    if (full) fromScratch = false;
    // 等待期间换了地图：以手上的为准重新应用
    const now = useChartFog.getState();
    const base = full ? null : now.map === map ? now.state : null;
    const { state, changed } = applyFogDelta(base, d, width, height);
    if (changed === null && now.map === map) {
      // 没有新揭开的格：只记下版本
      useChartFog.setState({ state });
      return false;
    }
    useChartFog.setState({ map, state, rows: null, changed: changed ?? "all", seq: ++seqNo, runs: changed === "all" || changed === null ? null : d.runs });
    return true;
  }
  return false;
}

function start(): Promise<boolean> {
  const p: Promise<boolean> = fetchDelta().finally(() => {
    if (running === p) running = null;
  });
  running = p;
  return p;
}

/**
 * 按 fog_delta 刷新迷雾（大地图）：since 取手上的版本（换了地图或还没有时为 0，后端给全量）。
 * 返回迷雾是否有变化。请求失败时 reject（调用方可以退回 fog()）。
 */
export function refreshFogDelta(map: string, width: number, height: number): Promise<boolean> {
  latest = { map, width, height };
  if (queued) return queued;
  if (!running) return start();
  const q: Promise<boolean> = running
    .catch(() => false)
    .then(() => {
      if (queued === q) queued = null;
      return start();
    });
  queued = q;
  return q;
}

/**
 * 事件连接因服务端积压（1013）断开、重连之后：从头取一次完整的迷雾（since 0、epoch 空）。
 * 还没有大地图的迷雾请求过（没有地图参数）时什么也不做。
 */
export function refreshFogFromScratch(): Promise<boolean> {
  fromScratch = true;
  if (!latest.map) return Promise.resolve(false);
  return refreshFogDelta(latest.map, latest.width, latest.height);
}

// 重连并要求从头读（resync）时，迷雾也从头取；一般的序号前进只让在路上的请求作废（见 fetchDelta）
onRequestSeq((_seq, reason) => {
  if (reason === "resync") void refreshFogFromScratch().catch(() => {});
});

/** 经典世界：整张文本（fog() 的结果）。 */
export function setFogRows(map: string, rows: string[]): void {
  useChartFog.setState({ map, state: null, rows, changed: "all", seq: ++seqNo, runs: null });
}

/** 当前的位图（大地图；经典世界为 null）。 */
export function fogBitsNow(): FogBits | null {
  return useChartFog.getState().state?.bits ?? null;
}

/** 某格是否已揭开（越界、缺行缺字算揭开，与迷雾画家一致）。 */
export type FogLookup = (x: number, y: number) => boolean;

/** 整张文本的查法。 */
export function rowsLookup(rows: readonly string[]): FogLookup {
  return (x, y) => (rows[y]?.[x] ?? "1") !== "0";
}

/** 位图的查法（不建文本）。 */
export function bitsLookup(bits: FogBits): FogLookup {
  return (x, y) => x < 0 || y < 0 || x >= bits.width || y >= bits.height || bits.get(x, y);
}

/** 这张地图的迷雾怎么查（还没有迷雾、或手上的属于别的地图时为 null：全部当作揭开）。 */
export function fogLookup(s: ChartFogStore, map: string): FogLookup | null {
  if (s.map !== map) return null;
  if (s.state) return bitsLookup(s.state.bits);
  if (s.rows) return rowsLookup(s.rows);
  return null;
}

/** 整张文本（旧的渲染器接口用：大地图时现建一份；没有迷雾为 null）。 */
export function fogRowsOf(s: ChartFogStore, map: string): string[] | null {
  if (s.map !== map) return null;
  return s.rows ?? s.state?.bits.toRows() ?? null;
}

/** 每个后台线程的喂法：引用数与已经喂到的序号。 */
const feeds = new WeakMap<ChartHub, { refs: number; seq: number; unsub: () => void }>();

/**
 * 让这张地图的迷雾持续喂给共用的后台线程（世界图的渲染器与航行视图都调用，同一个 hub 只喂一份）。返回注销函数。
 * 跟得上（只差一个序号）时给区间，否则给整张：大地图给位图，经典世界给文本。
 */
export function attachFogFeed(hub: ChartHub, map: string): () => void {
  let feed = feeds.get(hub);
  if (feed) feed.refs++;
  else {
    const f = { refs: 1, seq: -1, unsub: () => {} };
    const push = (s: ChartFogStore) => {
      if (s.map !== map || s.seq === f.seq) return;
      if (s.state) {
        if (s.runs && f.seq === s.seq - 1) hub.jobs.fogRuns(s.runs);
        else hub.jobs.fogSync(s.state.bits);
      } else if (s.rows) hub.jobs.fog(s.rows);
      else return;
      f.seq = s.seq;
    };
    f.unsub = useChartFog.subscribe(push);
    push(useChartFog.getState());
    feeds.set(hub, f);
    feed = f;
  }
  const mine = feed;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    mine.refs--;
    if (mine.refs > 0) return;
    mine.unsub();
    feeds.delete(hub);
  };
}

/** 清空（测试、换对局）。 */
export function resetChartFog(): void {
  running = null;
  queued = null;
  fromScratch = false;
  latest = { map: "", width: 0, height: 0 };
  useChartFog.setState({ map: null, state: null, rows: null, changed: null, seq: ++seqNo, runs: null });
}
