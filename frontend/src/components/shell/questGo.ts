// 任务的“去”（R10-Q02）：追踪条与任务日志里的同一个按钮，按任务视图的 go（R10-Q01 契约 4）一次点到要去的地方。
// - 港口：人不在那里——打开航线规划并填好目的地（在港时是舞台上的一张小卡 QuestRoute，在海上是世界海图上的航线规划）；
//   下令时总带上寻路偏好（内核据此记“规划航线”）。地方还看不见时说一句去打听。
// - 面板：打开它并圈出入口（新手教程的同一套圈法，tutorial/panelSpots.ts）。
// - 养成地点：城镇地图上把那处圈出来（日程定了、地图没摆出来时说一句下次排日程再去）。
// - 要等日子：在港时打开旅店，直接住到那一天（旅店照旧一天天推进，遇事提前醒）；不在港时提示先靠港。
import { create } from "zustand";
import { navActive, isManualWorld, useNavStore } from "../../hooks/useNavigation";
import { beginDeparture, chooseDestination, useVoyageStore } from "../../hooks/useVoyage";
import { tz } from "../../i18n/zhOnly";
import type { QuestGo, QuestImplicitRow, QuestPhase, QuestPlace, QuestRow, WorldDate } from "../../ipc/types";
import { flagship, useGame } from "../../store/game";
import { isExplicit, panelName } from "../people/questKit";
import { openPanel } from "../tutorial/panelSpots";
import { spotlight } from "../tutorial/spotStore";
import { targetEl } from "../tutorial/spot";
import { openWindow, showStage } from "./shellState";

/** “去”要用到的：任务的 go、所在的期、眼下那一行与隐式行（找地点与要等的天数）。 */
export interface QuestTarget {
  go: QuestGo | null;
  phase: QuestPhase;
  row?: QuestRow | QuestImplicitRow | null;
  rows?: readonly QuestRow[];
  implicit?: readonly QuestImplicitRow[];
}

interface QuestUi {
  /** 在港时的航线规划小卡：要去的港口（没有为 null） */
  route: { dest: number; name: string; seq: number } | null;
  /** 旅店要住到哪一天（旅店页看到它就开始住；住上了就清掉） */
  inn: { until: WorldDate; days: number; seq: number } | null;
}

export const useQuestUi = create<QuestUi>(() => ({ route: null, inn: null }));

let seq = 0;

/** 两个世界日期之间差几天（按世界日历的月长；没有日历时按每月 30 天）。b 早于 a 时为负。 */
export function daysBetween(a: WorldDate, b: WorldDate, months?: readonly number[] | null): number {
  const ms = months && months.length > 0 ? months : Array.from({ length: 12 }, () => 30);
  const year = ms.reduce((s, x) => s + x, 0);
  const idx = (d: WorldDate) => d[0] * year + ms.slice(0, Math.max(0, d[1] - 1)).reduce((s, x) => s + x, 0) + d[2];
  return idx(b) - idx(a);
}

/** 目标里点到的地点：go.port，其次眼下那一行的地点、去某地的隐式行。 */
function targetPlace(t: QuestTarget): QuestPlace | null {
  if (t.go?.port) return t.go.port;
  const row = t.row;
  if (row) {
    if (isExplicit(row) && row.place) return row.place;
    if (!isExplicit(row) && row.kind === "go_to" && !row.done && row.place) return row.place;
  }
  // 隐式行的地点键在数据里找不到时后端给 null：跳过它，再看显式行
  const go = t.implicit?.find((r) => r.kind === "go_to" && !r.done && r.place);
  if (go && go.kind === "go_to" && go.place) return go.place;
  return t.rows?.find((r) => !r.done && r.place)?.place ?? null;
}

/** 要等到的日子与还差几天。 */
function waitOf(t: QuestTarget): { until: WorldDate; days: number } | null {
  const row = t.row && !isExplicit(t.row) && t.row.kind === "wait_until" ? t.row : t.implicit?.find((r) => r.kind === "wait_until");
  const until = t.go?.wait_until ?? (row && row.kind === "wait_until" ? row.date : null);
  if (!until) return null;
  if (row && row.kind === "wait_until" && row.date.join("-") === until.join("-")) return { until, days: Math.max(1, row.days) };
  const g = useGame.getState();
  const today = g.overview?.world_date;
  // 概览的 world_date 与任务视图的日期同一种写法（[公历年, 月, 日]，quest_view.rs date() / views.rs world_date）
  const days = today ? daysBetween(today, until, g.statics?.world?.calendar?.months) : 1;
  return { until, days: Math.max(1, days) };
}

/** 驶往一座港口：海上打开世界海图的航线规划，在港打开舞台上的航线小卡（经典世界走原来的出港选目的地）。 */
function routeTo(dest: number, name: string): void {
  const g = useGame.getState();
  const f = flagship(g.overview);
  if (!f) {
    g.notify(tz("quest.goto.noFleet"));
    return;
  }
  if (!isManualWorld(g.statics)) {
    // 经典世界：出港 → 在海图上点选 → 确认框（与平时出港一样，只是目的地先填好）
    if (f.docked !== null) {
      beginDeparture();
      chooseDestination(dest);
    } else {
      useVoyageStore.setState({ picking: true, target: dest, plan: null });
      showStage("chart");
    }
    return;
  }
  if (navActive(g.statics, g.overview)) {
    useNavStore.setState({ view: "world", pick: dest });
    showStage("chart");
    return;
  }
  useQuestUi.setState({ route: { dest, name, seq: ++seq } });
  showStage("chart");
}

/** 在旅店住到那一天（旗舰队在港、时间不走时）；不在港时说一句先靠港。 */
function waitAtInn(until: WorldDate, days: number): void {
  const g = useGame.getState();
  const o = g.overview;
  const f = flagship(o);
  const docked = f?.docked ?? null;
  if (docked === null) {
    g.notify(tz("quest.goto.dockFirst"));
    return;
  }
  if (!o?.port_hold) {
    g.notify(tz("quest.goto.timeRuns"));
    return;
  }
  useQuestUi.setState({ inn: { until, days, seq: ++seq } });
  g.selectLoc(docked);
  g.setFacility("inn");
  openWindow("port");
}

/** 养成的城镇地图上圈出一处地点；地图没摆出来（这周的日程已经定了）时返回 false。 */
function spotPlace(place: string): boolean {
  const esc = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(place) : place.replace(/"/g, '\\"');
  const target = [`[data-testid="spot-${esc}"]`];
  if (!targetEl(target) && !targetEl('[data-testid="ub-town"]')) return false;
  spotlight([...target, '[data-testid="ub-town"]']);
  return true;
}

/** 点了“去”。 */
export function goQuest(t: QuestTarget): void {
  const g = useGame.getState();
  const o = g.overview;
  if (!o) return;
  const go = t.go;
  // 养成期：城里的地点、养成画面的某一块
  if (o.mode === "upbringing") {
    if (go?.place) {
      if (!spotPlace(go.place)) g.notify(tz("quest.goto.townLater"));
      return;
    }
    if (go?.panel && openPanel(go.panel, tz("quest.goto.panel", { panel: panelName(go.panel) })) === "ok") return;
    g.notify(tz("quest.goto.noPanel"));
    return;
  }
  const f = flagship(o);
  const place = targetPlace(t);
  if (place) {
    if (place.loc === null) {
      g.notify(tz("quest.goto.unknownPort"));
      return;
    }
    if (!f) {
      g.notify(tz("quest.goto.noFleet"));
      return;
    }
    if (f.docked !== place.loc) {
      routeTo(place.loc, place.label ?? "");
      return;
    }
  }
  // 人已经在地方了（或者这一步不用去哪儿）
  const wait = waitOf(t);
  if (wait) {
    waitAtInn(wait.until, wait.days);
    return;
  }
  if (go?.panel) {
    const label = tz("quest.goto.panel", { panel: panelName(go.panel) });
    if (openPanel(go.panel, label) === "need_port") g.notify(tz("quest.goto.notHere", { panel: panelName(go.panel) }));
    return;
  }
  if (place) {
    g.notify(tz("quest.goto.here", { place: place.label ?? "" }));
    return;
  }
  openWindow("quests");
}

/** 这件事有没有能“去”的地方（没有 go、没有地点、也不用等日子的不给按钮）。 */
export function canGo(t: QuestTarget): boolean {
  return !!(t.go && (t.go.port || t.go.place || t.go.panel || t.go.wait_until)) || targetPlace(t) !== null || waitOf(t) !== null;
}
