// 大地图的图层（UI-CONTRACT I3 的 map_resource）：第九批的世界 StaticView.map 只给尺寸、key、hash 与 wrap_x，
// external 为 true 时图层另取。按 hash 缓存：内存里留最近的 MEMORY_MAPS 张。hash 对不上（后端换了图）时重新取。
import { navApi } from "../ipc/api";
import type { MapResource, StaticView } from "../ipc/types";

/**
 * 内存里最多留几张图（P14a：桌面版内存不是约束，由 2 张放宽到 8 张——换世界、读别的世界的存档再回来不必重取；
 * 一张图层约 1–2 MB）。
 */
const MEMORY_MAPS = 8;
const memory = new Map<string, MapResource>();
const inflight = new Map<string, Promise<MapResource>>();

/** 缓存的键：有 hash 用 hash（内容寻址），否则用地图 key。 */
function cacheKeyOf(key: string, hash?: string | null): string {
  return hash ? `h:${hash}` : `k:${key}`;
}

function remember(k: string, r: MapResource) {
  memory.delete(k);
  memory.set(k, r);
  while (memory.size > MEMORY_MAPS) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

/**
 * 取一张地图的图层：内存 → 后端。同一张图同时只请求一次。
 * 给了 hash 时，后端返回的 hash 与之不同也照收（以后端为准），但按后端的 hash 记账。
 */
export function loadMapResource(key: string, hash?: string | null): Promise<MapResource> {
  const k = cacheKeyOf(key, hash);
  const hit = memory.get(k);
  if (hit) {
    remember(k, hit);
    return Promise.resolve(hit);
  }
  const pending = inflight.get(k);
  if (pending) return pending;
  const p = (async () => {
    const r = await navApi.mapResource(key);
    remember(k, r);
    if (r.hash && cacheKeyOf(key, r.hash) !== k) remember(cacheKeyOf(key, r.hash), r);
    return r;
  })().finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

/** 内存里已有的图层（没有时为 null）。 */
export function cachedMapResource(key: string, hash?: string | null): MapResource | null {
  return memory.get(cacheKeyOf(key, hash)) ?? null;
}

/** 清空内存缓存（测试用）。 */
export function clearMapResources(): void {
  memory.clear();
  inflight.clear();
}

/** 静态数据的地图是否要另取图层。 */
export function isExternalMap(statics: Pick<StaticView, "map"> | null | undefined): boolean {
  return statics?.map.external === true;
}

/** 把图层并进静态数据（海图、天况的海区采样等都按 StaticView.map 读）。 */
export function withMapResource(statics: StaticView, r: MapResource): StaticView {
  return {
    ...statics,
    map: {
      ...statics.map,
      width: r.width,
      height: r.height,
      rows: r.rows,
      relief: r.relief ?? undefined,
      biomes: r.biomes ?? undefined,
      wrap_x: r.wrap_x,
      key: r.key,
      hash: r.hash,
    },
  };
}
