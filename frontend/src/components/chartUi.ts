// 航海图左侧栏两个小窗（地点、图例）的折叠状态：切换舞台时保留，换一局也留着（只是界面习惯，不进存档）。
// null 表示玩家还没动过，由航海图按界面与场合决定（components/MapView.tsx）：
// 新界面缺省都收起（选目的地时地点列表展开），旧界面靠港时展开、航行时收起；手机上都收起。
import { create } from "zustand";

export const useChartUi = create<{ legend: boolean | null; places: boolean | null }>(() => ({ legend: null, places: null }));

/** 恢复成“还没动过”（测试用）。 */
export function resetChartUi(): void {
  useChartUi.setState({ legend: null, places: null });
}
