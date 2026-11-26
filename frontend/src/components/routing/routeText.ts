// H07 航线规划的界面文字。寰宇先只做中文：键先不进中英两张表，用 tzh 取——以后两张表里有了同名的键就照表取。
import { tzh } from "../../i18n";
import type { RouteHazardView, RoutePlanView, RoutePref } from "../../ipc/routing";

type Vars = Record<string, string | number>;
const r = (key: string, zh: string, vars?: Vars) => tzh(`route.${key}`, zh, vars);

const PREF_ZH: Record<RoutePref, string> = { distance: "按距离", fastest: "最快", safe: "稳妥", coastal: "沿岸" };
const PREF_TIP_ZH: Record<RoutePref, string> = {
  distance: "只看远近，走最短的路",
  fastest: "照这个月的风与洋流，挑最快到的路",
  safe: "绕开这个月风暴多、海盗多的海区，宁可慢一点",
  coastal: "贴着岸走，离岸不远，随时能靠岸",
};
const SEASON_ZH = ["春", "夏", "秋", "冬"];

export const routeText = {
  title: () => r("title", "航线预览"),
  pref: (p: RoutePref) => r(`pref.${p}`, PREF_ZH[p]),
  prefTip: (p: RoutePref) => r(`prefTip.${p}`, PREF_TIP_ZH[p]),
  prefGroup: () => r("prefGroup", "寻路偏好"),
  noNavigator: () => r("noNavigator", "没有领航员：只能按距离规划。在“岗位”里给这支舰队派一位领航员，就能照风与洋流挑路。"),
  leg: (i: number, name: string) => r("leg", "第 {i} 段 → {name}", { i: i + 1, name }),
  legDays: (n: number) => r("legDays", "约 {n} 天", { n }),
  legEdge: () => r("legEdge", "只能开到已知海域的边缘"),
  record: (n: number) => r("record", "纪录 {n} 天", { n }),
  firstVoyage: () => r("firstVoyage", "首航"),
  total: (n: number) => r("total", "全程约 {n} 天", { n }),
  food: (have: number, need: number) => r("food", "粮 {have} / 要 {need}", { have, need }),
  water: (have: number, need: number) => r("water", "水 {have} / 要 {need}", { have, need }),
  short: () => r("short", "粮水不够这一程"),
  failed: (i: number, msg: string) => r("failed", "第 {i} 站去不了：{msg}", { i: i + 1, msg }),
  go: (name: string) => r("go", "驶往 {name}", { name }),
  goVia: (name: string, n: number) => r("goVia", "驶往 {name}（行程共 {n} 站）", { name, n }),
  addStop: () => r("addStop", "加为经停点"),
  addStopTip: () => r("addStopTip", "把这一站排进行程，再点下一站"),
  clear: () => r("clear", "清空行程"),
  cancel: () => r("cancel", "取消"),
  loading: () => r("loading", "正在算航线……"),
  stopsNote: (names: string) => r("stopsNote", "行程：{names}", { names }),
  pickNext: () => r("pickNext", "在海图上点下一站"),
  nextStop: (name: string) => r("nextStop", "行程下一站：{name}", { name }),
  continue: () => r("continue", "继续行程"),
  dropItinerary: () => r("dropItinerary", "不去了"),
  monsoon: () => r("monsoon", "季风历"),
  monsoonTip: () => r("monsoonTip", "看各月的风向与洋流（只画已有海图的海区）"),
  month: (m: number) => r("month", "{m} 月", { m }),
  season: (s: number) => r("season", "{s}季", { s: SEASON_ZH[s] ?? "" }),
  monthNow: () => r("monthNow", "本月"),
  monthPrev: () => r("monthPrev", "上个月"),
  monthNext: () => r("monthNext", "下个月"),
  monsoonEmpty: () => r("monsoonEmpty", "还没有海图：航行揭开的海区才画得出风"),
};

/** 一条风险提示的文字。 */
export function hazardText(h: RouteHazardView): string {
  const when = h.month !== null ? routeText.month(h.month) : h.season !== null ? routeText.season(h.season) : "";
  const where = h.region ?? h.port ?? "";
  switch (h.kind) {
    case "storm":
      return r("hazard.storm", "{when}{where}风暴多", { when, where });
    case "pirate":
      return r("hazard.pirate", "{where}有海盗出没", { where });
    default:
      return r("hazard.frozen", "{when}{where}封冻", { when, where });
  }
}

/** 一程的粮水够不够（粮或水有一样不够就是不够）。 */
export function supplyShort(plan: Pick<RoutePlanView, "short">): boolean {
  return plan.short.food > 0 || plan.short.water > 0;
}
