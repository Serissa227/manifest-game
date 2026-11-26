// 按 id 查静态数据（地点、发现物、交易所）。
//
// 手动航行、hide_unknown_ports 的世界（寰宇）里，桌面版与命令通道的 static_data 只留看见过的地点、发现过的发现物，
// 以及挂在它们上面的道路、交易所、剧本（navigation_view/visibility.rs 的 filter_static）；留下的每一条保留原来的 id，
// 所以数组下标不再等于 id。不过滤的静态数据下标仍等于 id。两种都要对，界面一律按 id 查。
//
// 每个数组第一次查不中下标时建一张 id → 条目的表，按数组本身缓存（WeakMap）：换了静态数据就是新数组，表跟着重建；
// 测试里直接 setState 放进来的静态数据也一样。查不到（没看见过的地点、旧数据里没有的发现物）时为 undefined，由各处按“未知”处理。
import type { DiscoveryDefView, ExchangeView, LocView, StaticView } from "./types";

const tables = new WeakMap<readonly { id: number }[], Map<number, { id: number }>>();

/** 在带 id 的静态数组里按 id 取一条；没有这一条（或 id 为空）时为 undefined。 */
export function byId<T extends { id: number }>(list: readonly T[] | null | undefined, id: number | null | undefined): T | undefined {
  if (!list || id === null || id === undefined) return undefined;
  // 快路：下标正好等于 id（经典世界等不过滤的静态数据）
  const direct = list[id];
  if (direct !== undefined && direct.id === id) return direct;
  let table = tables.get(list);
  if (!table) {
    table = new Map(list.map((x) => [x.id, x]));
    tables.set(list, table);
  }
  return table.get(id) as T | undefined;
}

type Has<K extends keyof StaticView> = Partial<Pick<StaticView, K>> | null | undefined;

/** 按 id 取地点；没看见过（已滤掉）或不存在时为 undefined。 */
export function locById(statics: Has<"locations">, id: number | null | undefined): LocView | undefined {
  return byId(statics?.locations, id);
}

/** 按 id 取发现物的目录条目；还没发现（已滤掉）或不存在时为 undefined。 */
export function discoveryById(statics: Has<"discoveries">, id: number | null | undefined): DiscoveryDefView | undefined {
  return byId(statics?.discoveries, id);
}

/** 按 id 取期货交易所；所在港口没看见过（已滤掉）时为 undefined。 */
export function exchangeById(statics: Has<"exchanges">, id: number | null | undefined): ExchangeView | undefined {
  return byId(statics?.exchanges, id);
}
