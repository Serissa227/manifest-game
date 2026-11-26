// 游戏外壳的界面状态：功能窗口是否打开、各功能页窗口的摆放、当前实际显示的舞台。
// 窗口的内容由全局 store 的 tab 决定；这里只管“开 / 关”。
import { create } from "zustand";
import type { IconName } from "../../art/icons";
import type { NoticeView, Overview, StaticView } from "../../ipc/types";
import { readViewport, windowCovers } from "../../hooks/useViewport";
import { flagship, useGame, type Stage, type Tab } from "../../store/game";
import { useUiVersion } from "../../ui/uiMode";

interface ShellState {
  /** 功能窗口是否打开（关闭后只剩舞台，点命令栏重新打开） */
  windowOpen: boolean;
}

export const useShell = create<ShellState>(() => ({ windowOpen: true }));

/** 打开功能窗口；给出 tab 时同时切到该功能页。港口街景点建筑时也可调用它。 */
export function openWindow(tab?: Tab) {
  if (tab) useGame.getState().setTab(tab);
  useShell.setState({ windowOpen: true });
}

/** 关闭功能窗口。 */
export function closeWindow() {
  useShell.setState({ windowOpen: false });
}

/**
 * 切换主舞台（命令栏的“港口街景 / 航海图”与快捷键 M）。
 * - 切到航海图就是要看海图：新界面里顺手收起功能窗口（靠右的港口窗口开着时
 *   海图被盖掉四成）。之后在海图上点地点、点命令栏的功能页，窗口照常再打开。旧界面的桌面照旧不动窗口。
 * - 手机与竖放的平板上窗口盖满舞台：往哪边切都收起（原来就这样），免得切了看不见。
 */
export function showStage(target: Stage): void {
  if (windowCovers(readViewport()) || (target === "chart" && useUiVersion.getState().ui === "v2")) closeWindow();
  useGame.getState().setStage(target);
}

/**
 * 监听全局状态：功能页、港口设施或选中的地点变化时自动打开窗口
 * （例如在航海图上点选港口、在街景中点建筑、遭遇海盗后转到海战页）。返回取消监听的函数。
 */
export function watchWindowTriggers(): () => void {
  return useGame.subscribe((s, prev) => {
    if (s.tab !== prev.tab || s.facility !== prev.facility || s.selectedLoc !== prev.selectedLoc) {
      if (!useShell.getState().windowOpen) useShell.setState({ windowOpen: true });
    }
  });
}

/** 主角能否查看港口街景：旗舰队停在港口时才可以。 */
export function canSeeTown(o: Overview | null): boolean {
  const f = flagship(o);
  return !!f && f.docked !== null;
}

/** 实际显示的舞台：旗舰队在海上（或没有舰队）时只能看航海图。 */
export function shownStage(o: Overview | null, stage: Stage): Stage {
  return canSeeTown(o) ? stage : "chart";
}

/** 功能窗口的摆放：中窗口靠右，大窗口居中。 */
export type WindowPlacement = "right" | "center";
export type WindowSize = "medium" | "large";

export const WINDOW_LAYOUT: Record<Tab, { placement: WindowPlacement; size: WindowSize }> = {
  history: { placement: "center", size: "large" },
  secrets: { placement: "center", size: "large" },
  people: { placement: "center", size: "large" },
  quests: { placement: "right", size: "medium" },
  items: { placement: "center", size: "large" },
  codex: { placement: "center", size: "large" },
  port: { placement: "right", size: "medium" },
  fleet: { placement: "right", size: "medium" },
  mates: { placement: "right", size: "medium" },
  caravan: { placement: "right", size: "medium" },
  industry: { placement: "center", size: "large" },
  colonies: { placement: "center", size: "large" },
  explore: { placement: "center", size: "large" },
  battle: { placement: "center", size: "large" },
  futures: { placement: "center", size: "large" },
  analysis: { placement: "center", size: "large" },
  reports: { placement: "center", size: "large" },
  intel: { placement: "center", size: "large" },
  settings: { placement: "center", size: "medium" },
  debug: { placement: "center", size: "large" },
};

/** 功能页的图标。 */
export const TAB_ICONS: Record<Tab, IconName> = {
  history: "calendar",
  secrets: "relic",
  people: "crew",
  quests: "quest",
  items: "cargo",
  codex: "quest",
  port: "port",
  fleet: "fleet",
  mates: "mate",
  futures: "futures",
  analysis: "forecast",
  caravan: "caravan",
  industry: "industry",
  colonies: "colony",
  explore: "discovery",
  reports: "report",
  intel: "intel",
  settings: "settings",
  battle: "battle",
  debug: "debug",
};

/** 世界里有殖民点，或主角已有殖民地时，命令栏才出现“殖民地”。 */
export function hasColonies(statics: StaticView | null | undefined, o: Overview | null): boolean {
  return (statics?.locations.some((l) => l.kind === "site") ?? false) || (o?.colonies?.length ?? 0) > 0;
}

/** 世界里有期货交易所时才有“期货”页与港口的“期货交易所”一页（寰宇没有期货；旧数据没有这个字段时照旧显示）。 */
export function hasFutures(statics: StaticView | null | undefined): boolean {
  return statics?.exchanges === undefined || statics.exchanges.length > 0;
}

/** 世界里有发现物时，命令栏才出现“探险”。 */
export function hasExplore(statics: StaticView | null | undefined): boolean {
  return (statics?.discoveries?.length ?? 0) > 0;
}

/**
 * 命令栏上的功能页顺序：有进行中的战术海战时在“港口”后插入“海战”，开发者模式追加“调试”；
 * 世界里有殖民点 / 发现物时在“产业”后加上“殖民地”“探险”（没有扩展内容的旧数据照旧）。
 */
export function commandTabs(o: Overview | null, devMode: boolean, statics?: StaticView | null): Tab[] {
  const extra: Tab[] = [];
  if (hasColonies(statics, o)) extra.push("colonies");
  if (hasExplore(statics)) extra.push("explore");
  // 第九批的世界按打开的模块加功能页：行囊（物品与装备）、图鉴
  const mods = statics?.world?.modules ?? [];
  const f9: Tab[] = [
    ...(mods.includes("cast") ? (["people", "quests"] as Tab[]) : []),
    ...(mods.includes("items") ? (["items", "codex"] as Tab[]) : []),
    ...(mods.includes("history") ? (["history"] as Tab[]) : []),
    ...(["societies", "arcana", "ideas", "realms"].some((m) => mods.includes(m)) ? (["secrets"] as Tab[]) : []),
  ];
  const futures: Tab[] = hasFutures(statics) ? ["futures"] : [];
  const base: Tab[] = ["port", "fleet", "mates", ...f9, ...futures, "analysis", "caravan", "industry", ...extra, "reports", "intel", "settings"];
  const withBattle: Tab[] = o && o.tactical_battles.length > 0 ? [base[0], "battle", ...base.slice(1)] : base;
  return devMode ? [...withBattle, "debug"] : withBattle;
}

/**
 * 命令栏按钮上的小红点（有才显示）：返回这一页有几件新东西。眼下只有人物页——见闻簿里没读过的见闻（I5b 的 news_unread；
 * 旧后端没有这个字段时为 0）。
 */
export function tabAlert(o: Overview | null, tab: Tab): number {
  if (tab === "people") return Math.max(0, o?.story?.news_unread ?? 0);
  return 0;
}

/** 手机底部导航的常驻功能页（网页自适应）：按这个顺序取前三个存在的（海战只在进行中时出现，出现时排在舰队前面）。 */
const PRIMARY: readonly Tab[] = ["port", "battle", "fleet", "analysis", "mates"];

/** 手机底部导航里常驻的功能页（其余收进“更多”）。 */
export function primaryTabs(tabs: readonly Tab[], n = 3): Tab[] {
  return PRIMARY.filter((k) => tabs.includes(k)).slice(0, n);
}

/** 殖民地存粮（不计产出）低于这么多天时，在航海日志里提醒。 */
export const COLONY_LOW_FOOD_DAYS = 5;

/**
 * 航海日志的提醒：后端给出的提醒，加上由概览推算的殖民地提醒（断粮、存粮不足）。
 * 后端已给出同类提醒时不再重复推算。
 */
export function shellNotices(o: Pick<Overview, "notices" | "colonies">): NoticeView[] {
  const list = [...o.notices];
  const has = new Set(o.notices.map((n) => n.kind));
  for (const c of o.colonies ?? []) {
    if (c.starving_days > 0) {
      if (!has.has("colonyStarving")) list.push({ kind: "colonyStarving", args: [["colony", c.name], ["days", String(c.starving_days)]] });
    } else if (c.food_days < COLONY_LOW_FOOD_DAYS && !has.has("colonyLowFood")) {
      list.push({ kind: "colonyLowFood", args: [["colony", c.name], ["days", String(Math.max(0, c.food_days))]] });
    }
  }
  return list;
}

/** 功能窗口的 id（命令栏标签的 aria-controls 指向它）。 */
export const WINDOW_ID = "shell-window";

/** 命令栏上功能页按钮的 id（窗口用它作为可访问名称）。 */
export function commandTabId(tab: Tab): string {
  return `cmd-tab-${tab}`;
}
