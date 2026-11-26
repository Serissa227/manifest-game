// 回主菜单的确认框开没开着（LeaveConfirm.tsx 的 <LeaveConfirmHost /> 读它；按钮调 askLeave()）。
import { create } from "zustand";

export const useLeaveAsk = create<{ open: boolean }>(() => ({ open: false }));

/** “主菜单”按钮：先弹确认框，点了“回到主菜单”才离开这一局 */
export function askLeave() {
  useLeaveAsk.setState({ open: true });
}
