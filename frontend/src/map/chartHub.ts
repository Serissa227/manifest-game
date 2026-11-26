// 同一张海图的计算共用一个后台线程：世界图的渲染器（renderer.ts）与航行视图（NavCanvas）各自订阅，
// 由第一个使用者创建、最后一个离开时销毁。大地图（1080 × 396）的整图每格 4 像素就有约 27 MB，不能各算一份。
import type { ChartInput } from "../art/map";
import { DETAIL_CELL } from "../art/map/types";
import type { FogCells, RgbaImage } from "./chartWork";
import { createChartJobs, type ChartJobs } from "./chartJobs";
import { acquireHdPool, type HdPool } from "./hdTiles";
import { worldScaleOf } from "./tiles";

export interface ChartListener {
  chart?: (season: number, img: RgbaImage) => void;
  fog?: (img: RgbaImage | null, cells?: FogCells) => void;
  tile?: (season: number, tx: number, ty: number, img: RgbaImage) => void;
  /** 细节瓦片（M01）：地形与迷雾各一张 */
  detail?: (season: number, tx: number, ty: number, img: RgbaImage | null) => void;
  fogTile?: (tx: number, ty: number, img: RgbaImage | null) => void;
  /** 高清瓦片（H10c）的迷雾 */
  hdFog?: (tx: number, ty: number, k: number, img: RgbaImage | null) => void;
}

export interface ChartHub {
  readonly key: string;
  readonly input: ChartInput;
  /** 世界图的缩小倍数（大地图 2：每格 2 像素） */
  readonly scale: 1 | 2;
  /** 有细节瓦片（M01“细海图”）：海图输入带着细图层、尺寸与航行网格对得上（只有寰宇） */
  readonly detail: boolean;
  readonly jobs: ChartJobs;
  /** 最近一次的世界图（季节与图），后来的订阅者可以直接拿到 */
  last: { season: number; img: RgbaImage } | null;
  subscribe: (l: ChartListener) => () => void;
  /** 用完了：订阅都退了、使用者都放手时销毁 */
  release: () => void;
}

const hubs = new Map<string, ChartHub & { refs: number; listeners: Set<ChartListener> }>();

/** 一张海图的计算中心的键：数据、地图 key 与 hash、尺寸（世界图的渲染器与航行视图按同一个键共用）。 */
export function chartHubKey(s: { data_hash: string; map: { key?: string; hash?: string; width: number; height: number } }): string {
  return `${s.data_hash}:${s.map.key ?? ""}:${s.map.hash ?? ""}:${s.map.width}x${s.map.height}`;
}

/**
 * 取得（必要时创建）一张海图的计算中心。key 区分不同的地图与数据（例如 `${data_hash}:${map.hash}`）。
 * opts.worker 为 false 时只用主线程（测试用）。
 */
export function acquireChartHub(key: string, input: ChartInput, opts: { worker?: boolean } = {}): ChartHub {
  const found = hubs.get(key);
  if (found) {
    found.refs++;
    return found;
  }
  const listeners = new Set<ChartListener>();
  const scale = worldScaleOf(input.width, input.height);
  /** 已经算出过迷雾 */
  let hasFog = false;
  const fine = input.fine;
  /** 带细图层的地图：航行画面的高清瓦片线程池跟着海图的计算中心一起建（进入航行画面时线程已经热了） */
  let hdPool: HdPool | null = null;
  const hub = {
    key,
    input,
    scale,
    detail: !!fine && fine.sub === DETAIL_CELL && fine.width === input.width && fine.height === input.height,
    refs: 1,
    listeners,
    last: null as { season: number; img: RgbaImage } | null,
    jobs: null as unknown as ChartJobs,
    subscribe(l: ChartListener) {
      listeners.add(l);
      // 后来的订阅者没赶上第一次的整张迷雾：补一张
      if (l.fog && hasFog) hub.jobs.fogFull();
      return () => {
        listeners.delete(l);
      };
    },
    release() {
      hub.refs--;
      if (hub.refs > 0) return;
      hub.jobs.destroy();
      hdPool?.release();
      hdPool = null;
      listeners.clear();
      hubs.delete(key);
    },
  };
  hub.jobs = createChartJobs(
    input,
    {
      chart: (season, img) => {
        hub.last = { season, img };
        for (const l of listeners) l.chart?.(season, img);
      },
      fog: (img, cells) => {
        hasFog = true;
        for (const l of listeners) l.fog?.(img, cells);
      },
      tile: (season, tx, ty, img) => {
        for (const l of listeners) l.tile?.(season, tx, ty, img);
      },
      detail: (season, tx, ty, img) => {
        for (const l of listeners) l.detail?.(season, tx, ty, img);
      },
      fogTile: (tx, ty, img) => {
        for (const l of listeners) l.fogTile?.(tx, ty, img);
      },
      hdFog: (tx, ty, k, img) => {
        for (const l of listeners) l.hdFog?.(tx, ty, k, img);
      },
    },
    // 内存账本按海图的键记（map/memory.ts）：最后一个使用者放手时 destroy 清掉这张图的账
    { worker: opts.worker, scale, ledgerKey: key },
  );
  hubs.set(key, hub);
  if (hub.detail && opts.worker !== false) hdPool = acquireHdPool(key, input);
  return hub;
}
