// 殖民地界面的临时状态：“建立殖民地”对话框开在哪个殖民点、殖民地窗口要定位到哪座建筑或哪一节。
// 只是界面状态，不进存档；街景按钮、港口窗口与殖民地窗口通过它互相跳转。
import { create } from "zustand";
import { useGame } from "../../store/game";
import { openWindow } from "../shell/shellState";

/** 殖民地窗口打开后要定位的地方：某座建筑（建筑 id），或库存与装卸一节。 */
export type ColonyFocus = { building: number } | { section: "cargo" };

interface ColonyUiState {
  /** 打开“建立殖民地”对话框的殖民点（地点 id）；null 表示对话框关着 */
  foundSite: number | null;
  /** 殖民地窗口要定位的建筑或分节 */
  focus: ColonyFocus | null;
}

export const useColonyUi = create<ColonyUiState>(() => ({ foundSite: null, focus: null }));

/**
 * 打开殖民点的“建立殖民地”对话框：选中这个殖民点并打开港口窗口；
 * 已在“殖民地”页时留在殖民地窗口（它在名册上方显示同一处殖民点的卡片，由卡片挂出对话框），并清空选中的殖民地。
 */
export function openFoundDialog(site: number) {
  const g = useGame.getState();
  const stay = g.tab === "colonies";
  g.selectLoc(site);
  if (stay) g.selectColony(null);
  useColonyUi.setState({ foundSite: site });
  openWindow(stay ? "colonies" : "port");
}

export function closeFoundDialog() {
  useColonyUi.setState({ foundSite: null });
}

/** 打开殖民地窗口并选中某个殖民地，可选地定位到一座建筑或装卸一节。 */
export function openColony(colony: number, focus: ColonyFocus | null = null) {
  useGame.getState().selectColony(colony);
  useColonyUi.setState({ focus });
  openWindow("colonies");
}

/** 清除定位（换了殖民地或用户自己滚动后）。 */
export function clearColonyFocus() {
  useColonyUi.setState({ focus: null });
}

// 换了地点或离开游戏时关掉“建立殖民地”对话框；换了殖民地时清除定位
useGame.subscribe((s, prev) => {
  const ui = useColonyUi.getState();
  if (ui.foundSite !== null && (s.selectedLoc !== ui.foundSite || !s.overview)) useColonyUi.setState({ foundSite: null });
  if (ui.focus !== null && s.selectedColony !== prev.selectedColony) useColonyUi.setState({ focus: null });
});
