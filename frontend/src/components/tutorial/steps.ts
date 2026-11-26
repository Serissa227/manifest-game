// 新手教程的步骤：每一步高亮界面上的一个真实元素（找不到或看不见时说明框居中），进入前可以先把界面准备好（打开港口窗口的交易所等），
// 玩家做了这一步要做的事（买了货、点了出港）时自动进入下一步；玩家中途退回去了（确认航线时回到了港口街景）就自动退回上一步。
// 文字在 i18n 的 tutorial 模块（tut.<id>.title / tut.<id>.text）。
import { readViewport, windowCovers } from "../../hooks/useViewport";
import { useVoyageStore } from "../../hooks/useVoyage";
import { flagship, useGame } from "../../store/game";
import { showMarketSide } from "../panels/marketUi";
import { closeWindow, openWindow } from "../shell/shellState";

/** 进入一步时记下的起点，供“做完了没有”与“退回去了没有”比较。 */
export interface Baseline {
  /** 旗舰队货舱里的货量 */
  cargo: number;
  /** 进入这一步时正在海图上选目的地（点了“出港”才进来的；直接点“下一步”进来的为 false） */
  picking: boolean;
}

export interface TutorialStep {
  id: string;
  /** 高亮的元素（CSS 选择器）；给一串时取第一个看得见的（手机上有的东西收在“菜单”“更多”里，改圈入口）；都找不到时说明框居中 */
  target?: string | readonly string[];
  /** 新界面桌面的一行顶栏上改圈的元素（目标一格、存档键就在顶栏上）；不写的步骤照 `target` */
  rowTarget?: string | readonly string[];
  /** 进入这一步前准备界面 */
  prepare?: () => void;
  /** 玩家做完了这一步要做的事：自动进入下一步 */
  done?: (base: Baseline) => boolean;
  /** 玩家退回了上一步的状态（例如点了出港、确认航线时又回到了港口街景）：自动退回上一步。
   *  直接点“下一步”跳过来的不算——否则点“下一步”会被弹回去。 */
  undo?: (base: Baseline) => boolean;
  /** 找不到目标时说明框放在左下角、不压暗（例如在海图上选港口时，不挡住海图） */
  corner?: boolean;
}

function fleet() {
  return flagship(useGame.getState().overview);
}

function docked(): boolean {
  const f = fleet();
  return !!f && f.docked !== null;
}

export function baseline(): Baseline {
  return { cargo: fleet()?.used ?? 0, picking: picking() };
}

/** 旗舰队在港时切到港口街景。手机与竖放的平板上功能窗口盖满舞台（盖住街景），顺手收起。 */
function showTown(): void {
  if (docked()) useGame.getState().setStage("town");
  if (windowCovers(readViewport())) closeWindow();
}

/** 旗舰队在港时打开港口窗口的某个设施（交易所、酒馆）。 */
function openFacility(facility: "market" | "tavern"): void {
  const g = useGame.getState();
  const f = fleet();
  if (!f || f.docked === null) return;
  g.setStage("town");
  g.selectLoc(f.docked);
  g.setFacility(facility);
  openWindow("port");
}

const openMarket = () => openFacility("market");
const openTavern = () => openFacility("tavern");
/** 打开交易所的买入页（船上有货时交易所默认打开卖出页，例如身世给了几件货）。 */
const openBuy = () => {
  openMarket();
  showMarketSide("buy");
};

/** 正在海图上为旗舰队选目的地（点了“出港”、海图在前面）。 */
function picking(): boolean {
  return useVoyageStore.getState().picking && useGame.getState().stage === "chart";
}

export const STEPS: readonly TutorialStep[] = [
  { id: "welcome" },
  { id: "cash", target: ".hud-cash" },
  // 手机顶栏里目标是现金下面的一条细进度（全文在“菜单”里）；新界面桌面的一行顶栏里是数字那一格里的“目标”一格（窄窗口里换回细进度）
  { id: "goal", target: [".hud-goal", ".hud-menu-btn"], rowTarget: [".hud-goal-stat", ".hud-goal", ".hud-menu-btn"] },
  { id: "time", target: ".hud-time" },
  { id: "town", target: '[data-testid="stage-town"]', prepare: showTown },
  { id: "market", target: '[data-testid="market"]', prepare: openMarket },
  // 账台：现金与装载一直在窗口底部；每行调数量、在这里一次成交（交易操作现代化）。先认识账台，再买第一笔货
  { id: "cart", target: '[data-testid="mk-cart"]', prepare: openBuy },
  { id: "buy", target: '[data-testid="mk-buy"]', prepare: openBuy, done: (b) => (fleet()?.used ?? 0) > b.cargo },
  { id: "sell", target: '[data-testid="market"] [role="tablist"]', prepare: openMarket },
  // 命令栏放不下时“行情”收在“更多”里：圈“更多”
  { id: "info", target: ['.cmd-tabs [data-tab="analysis"]:not(.is-overflow)', '[data-testid="cmd-more"]'] },
  // 船员：少于最低人数开不了船；酒馆最上面（和“舰队”页）可以一键补足
  { id: "crew", target: '[data-testid="tavern-crew"]', prepare: openTavern },
  { id: "depart", target: ".scene-depart", prepare: showTown, done: () => picking() || !docked() },
  // 确认框还没出现（正在海图上选港口）或看不见时说明框放在左下角、不压暗；
  // 点了出港才进来的，回到港口街景（取消出港、或点了底栏的“港口”）时退回“出港”一步
  {
    id: "route",
    target: '[data-testid="departure-dialog"]',
    corner: true,
    done: () => !docked(),
    undo: (b) => b.picking && docked() && !picking(),
  },
  { id: "sea" },
  // 平板与手机上存档收在顶栏的“菜单”里：圈“菜单”；新界面桌面的一行顶栏上有一次点到的存档键：圈它
  { id: "save", target: [".saves", ".hud-menu-btn"], rowTarget: [".hud-save-btn", ".hud-menu-btn"] },
  { id: "end" },
];

/**
 * 养成教程（第九批，FRAMEWORK §7.14）：主角在养成中、这台设备上没看过时自动开始。讲的是养成主画面的几块：
 * 主角与四条数值、本月日程（家乡期每旬一格、学院期课业 + 课后）、活动卡片与补选、自动安排、预计与疲劳、开始这个月、
 * 右边的属性 / 羁绊 / 日历分页。没有"做完自动进下一步"的步骤，玩家照着说明点"下一步"。
 */
export const UB_STEPS: readonly TutorialStep[] = [
  { id: "ub_welcome" },
  { id: "ub_hero", target: ".ub-hero" },
  { id: "ub_plan", target: ".ub-grid" },
  { id: "ub_cards", target: ".ub-acts" },
  { id: "ub_auto", target: ".ub-preset" },
  { id: "ub_go", target: ".ub-plan-foot" },
  { id: "ub_side", target: ".ub-side" },
  { id: "ub_calendar", target: ".ub-countdowns" },
  { id: "ub_end" },
];
