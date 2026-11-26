// H07 航线规划的查询与类型：航线预览（route_plan）、季风历（monsoon）、航线纪录（route_records）。
// 数都由后端（内核）算，前端只画。走 Tauri 命令。
import { invoke } from "@tauri-apps/api/core";

/** 寻路偏好：按距离（老办法）、最快、稳妥、沿岸。后三种要舰队有领航员。 */
export type RoutePref = "distance" | "fastest" | "safe" | "coastal";
export const ROUTE_PREFS: readonly RoutePref[] = ["distance", "fastest", "safe", "coastal"];

/** 行程中的一段。 */
export interface RouteLegView {
  dest: number;
  name: string;
  /** 这段的出发港（第一段在海上出发时为 null） */
  from: number | null;
  /** 粗格路径（格坐标） */
  path: [number, number][];
  /** 只能开到已知海域的边缘 */
  edge: boolean;
  minutes: number;
  days: number;
  /** 途经的海区名 */
  regions: string[];
  /** 这对港口的航时纪录 */
  record: { days: number; minutes: number; day: number } | null;
}

export interface RouteHazardView {
  kind: "storm" | "pirate" | "frozen";
  leg: number;
  /** 有 12 个月表时的月份 1–12，否则为 null（看 season） */
  month: number | null;
  season: number | null;
  region: string | null;
  port: string | null;
  bp: number;
}

/** 航线预览。 */
export interface RoutePlanView {
  fleet: number;
  /** distance：没有领航员（或规则关着），只能按距离；timed：能按用时 */
  tier: "distance" | "timed";
  pref: RoutePref;
  /** 这支舰队能选的偏好 */
  prefs: RoutePref[];
  legs: RouteLegView[];
  minutes: number;
  days: number;
  required: { food: number; water: number };
  have: { food: number; water: number };
  short: { food: number; water: number };
  hazards: RouteHazardView[];
  /** 第几站寻路失败（之前的各段照常给出） */
  failed: { stop: number; dest: number | null; code: string; message: string } | null;
  /** 当前月份（1–12；只有四季的世界为 null） */
  month: number | null;
}

/** 季风历的一个取样点：格坐标、风去向（0 北，顺时针 8 向）、风力、流去向、流强。 */
export type MonsoonPoint = [number, number, number, number, number, number];

export interface MonsoonView {
  /** 导航周期数：12 为月份，4 为季节 */
  periods: number;
  /** 这份数据的周期（从 0 起） */
  period: number;
  /** 当前周期（从 0 起） */
  now: number;
  /** 取样间隔（格） */
  step: number;
  points: MonsoonPoint[];
}

export interface RouteRecordView {
  origin: number;
  origin_name: string;
  dest: number;
  name: string;
  days: number;
  minutes: number;
  day: number;
}

export const routingApi = {
  /** 航线预览：从舰队现在的位置依次驶往各站；pref 为 null 时按命令的缺省（有领航员最快，没有按距离）。 */
  routePlan: (fleet: number, stops: number[], pref: RoutePref | null) =>
    invoke<RoutePlanView>("route_plan", { request: { fleet, stops, pref } }),
  /** 季风历：month 为 1–12（只有四季的世界为 1–4），null 为当前。 */
  monsoon: (month: number | null) => invoke<MonsoonView>("monsoon", { month }),
  routeRecords: () => invoke<{ enabled: boolean; records: RouteRecordView[] }>("route_records"),
};
