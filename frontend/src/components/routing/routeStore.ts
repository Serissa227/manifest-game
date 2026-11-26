// H07 航线规划的前端状态：正在排的经停点、选的偏好、已经出发的多站行程（剩下的各站），季风历开没开、看哪个月。
// 只是界面的记事本：航线、天数、粮水、风险都由后端（内核）算；行程的下一站要玩家在港里点一下“继续”才出发。
import { create } from "zustand";
import type { RoutePref } from "../../ipc/routing";

export interface Itinerary {
  fleet: number;
  /** 还没去的各站（第一项是下一站） */
  stops: number[];
  pref: RoutePref | null;
}

export interface RouteStore {
  /** 世界图上已经排进行程的经停点（不含当前点选的终点） */
  stops: number[];
  /** 玩家选的偏好；null 表示按缺省（有领航员最快，没有按距离） */
  pref: RoutePref | null;
  /** 已经出发的多站行程 */
  itinerary: Itinerary | null;
  /** 季风历 */
  monsoon: boolean;
  /** 季风历看的月份（1–12；只有四季的世界为 1–4）；null 为当前 */
  month: number | null;
  /** 航线预览已经拿到了（世界图提示条据此收起原来的“驶往”快捷按钮；旧后端没有 route_plan 时一直是 false） */
  shown: boolean;
}

export const useRouteStore = create<RouteStore>(() => ({
  stops: [],
  pref: null,
  itinerary: null,
  monsoon: false,
  month: null,
  shown: false,
}));

/** 清空正在排的行程（经停点）；偏好保留。 */
export function clearStops() {
  useRouteStore.setState({ stops: [] });
}

/** 正在排的行程：经停点加上当前点选的终点（点选的和最后一个经停点相同时不重复）。 */
export function plannedStops(stops: readonly number[], pick: number | null): number[] {
  if (pick === null || stops[stops.length - 1] === pick) return [...stops];
  return [...stops, pick];
}

/** 把多段的路径接成一条（后一段的起点就是前一段的终点，去掉重复的那一格）。 */
export function joinPaths(paths: readonly (readonly [number, number])[][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of paths) {
    for (const c of p) {
      const last = out[out.length - 1];
      if (last && last[0] === c[0] && last[1] === c[1]) continue;
      out.push([c[0], c[1]]);
    }
  }
  return out;
}

/** 拨月份：在 1..periods 里循环。 */
export function stepMonth(month: number, delta: number, periods: number): number {
  const n = Math.max(1, periods);
  return ((((month - 1 + delta) % n) + n) % n) + 1;
}
