// 面板键（data/worlds/terra16/guide/mechanics.toml 的 [[panels]]，R10-Q01 契约 1b）→ 前端怎么打开、圈哪里（R10-Q02）。
// 与新手教程的步骤同一个思路：先“准备界面”（打开港口窗口的某一页、切到某个功能页、切舞台），再圈出入口（Spotlight）。
// 港口里的几页要旗舰队停在港里才打得开；打不开时返回原因，由调用方说一句。
import { readViewport, windowCovers } from "../../hooks/useViewport";
import { useNavStore } from "../../hooks/useNavigation";
import { flagship, useGame, type PortPage, type Tab } from "../../store/game";
import { SIDE_TABS, type SideTab } from "../upbringing/ubKit";
import { closeWindow, openWindow, showStage } from "../shell/shellState";
import { spotlight } from "./spotStore";
import type { SpotTarget } from "./spot";

interface VoyageSpot {
  /** 港口窗口的一页（要旗舰队在港） */
  port?: PortPage;
  /** 命令栏的一个功能页 */
  tab?: Tab;
  /** 只切舞台（航海图 / 港口街景） */
  stage?: "chart" | "town";
  /** 航行中切到世界海图（航线规划在那里） */
  world?: boolean;
  target: SpotTarget;
}

const PORT_BODY: readonly string[] = ['[data-testid="port-panel"] .tab-body', '[data-testid="port-panel"]'];
const WINDOW: readonly string[] = ["#shell-window"];

/** 航海期的面板。 */
export const VOYAGE_SPOTS: Record<string, VoyageSpot> = {
  market: { port: "market", target: ['[data-testid="market"]', ...PORT_BODY] },
  analysis: { tab: "analysis", target: WINDOW },
  house: { port: "invest", target: PORT_BODY },
  warehouse: { port: "warehouse", target: PORT_BODY },
  agency: { port: "warehouse", target: ['[data-testid="agency"]', ...PORT_BODY] },
  industry: { tab: "industry", target: WINDOW },
  caravan: { tab: "caravan", target: WINDOW },
  bank: { port: "bank", target: PORT_BODY },
  guild: { port: "guild", target: PORT_BODY },
  office: { port: "office", target: PORT_BODY },
  shipyard: { port: "shipyard", target: PORT_BODY },
  secrets: { tab: "secrets", target: WINDOW },
  tavern: { port: "tavern", target: ['[data-testid="tavern-crew"]', ...PORT_BODY] },
  fleet: { tab: "fleet", target: WINDOW },
  mates: { tab: "mates", target: WINDOW },
  supply: { tab: "fleet", target: ['[data-testid="supply-desk"]', ...WINDOW] },
  ship_status: { stage: "chart", target: ['[data-testid="ship-status"]', '[data-testid="fleet-sail-supply"]'] },
  depart: { stage: "town", target: [".scene-depart:not(.scene-inn)", ".scene-depart"] },
  navigation: { stage: "chart", target: ['[data-testid="map-container"]'] },
  route_planner: { stage: "chart", world: true, target: ['[data-testid="route-planner"]', '[data-testid="nav-worldbar"]'] },
  battle: { tab: "battle", target: WINDOW },
  explore: { tab: "explore", target: WINDOW },
  colonies: { tab: "colonies", target: WINDOW },
  shop: { port: "shop", target: PORT_BODY },
  auction: { port: "auction", target: PORT_BODY },
  inventory: { tab: "items", target: WINDOW },
  people: { tab: "people", target: WINDOW },
  history: { tab: "history", target: WINDOW },
  inn: { port: "inn", target: ['[data-testid="inn"]', ...PORT_BODY] },
  intel: { tab: "intel", target: WINDOW },
  reports: { tab: "reports", target: WINDOW },
};

interface UbSpot {
  /** 右栏要切到的分页 */
  side?: SideTab;
  target: SpotTarget;
}

/** 养成期的面板（养成画面只有一屏：切右栏的分页，或把那一块滚进视野）。 */
export const UB_SPOTS: Record<string, UbSpot> = {
  ub_planner: { target: [".ub-grid", ".ub-planner"] },
  ub_town: { target: ['[data-testid="ub-town"]'] },
  ub_bonds: { side: "bonds", target: [".ub-side-body", ".ub-side"] },
  ub_path: { side: "path", target: [".ub-path", ".ub-side"] },
  ub_goals: { side: "path", target: ['[data-testid="ub-goals"]', ".ub-side"] },
  ub_letters: { side: "letters", target: [".ub-side-body", ".ub-side"] },
  ub_contest: { target: [".ub-contests", ".ub-hero"] },
  ub_graduation: { target: [".ub-hero"] },
};

/** 打开面板的结果：ok 打开了；need_port 要在港里；unknown 不认识这个键。 */
export type PanelOpen = "ok" | "need_port" | "unknown";

/** 切养成右栏的分页：右栏的分页键是 UpbringingScreen 自己的状态，这里点它的分页按钮（与玩家点一下一样）。 */
function pickSideTab(side: SideTab): void {
  const i = SIDE_TABS.indexOf(side);
  const tabs = document.querySelectorAll<HTMLButtonElement>('.ub-side [role="tab"]');
  const btn = tabs[i];
  if (btn && btn.getAttribute("aria-selected") !== "true") btn.click();
}

/** 打开一个面板并圈出入口。label 是圈旁边的一小行字（可空）。 */
export function openPanel(key: string, label: string | null = null): PanelOpen {
  const g = useGame.getState();
  const ub = UB_SPOTS[key];
  if (ub) {
    if (ub.side) pickSideTab(ub.side);
    spotlight(ub.target, { label });
    return "ok";
  }
  const s = VOYAGE_SPOTS[key];
  if (!s) return "unknown";
  const f = flagship(g.overview);
  const docked = f?.docked ?? null;
  if (s.port) {
    if (docked === null) return "need_port";
    g.selectLoc(docked);
    g.setFacility(s.port);
    openWindow("port");
  } else if (s.tab) {
    openWindow(s.tab);
  } else if (s.stage) {
    // 港口街景只在靠港时看得到；在海上要“出港”“街景”的就只切到航海图
    if (s.stage === "town" && docked === null) return "need_port";
    showStage(s.stage);
    if (s.stage === "town" && windowCovers(readViewport())) closeWindow();
    if (s.world && docked === null) useNavStore.setState({ view: "world" });
  }
  spotlight(s.target, { label });
  return "ok";
}

/** 这个面板键要在港里才能打开（港口窗口的一页、港口街景）。 */
export function panelNeedsPort(key: string): boolean {
  const s = VOYAGE_SPOTS[key];
  return !!s && (!!s.port || s.stage === "town");
}
