// 回主菜单先问一句。
// 顶栏菜单、紧凑顶栏的菜单、养成画面的菜单都是弹出式的，点对话框会把菜单收起、卸下里面的组件；
// 所以确认框挂在常驻的主画面里（GameShell、UpbringingScreen 各挂一个 <LeaveConfirmHost />），按钮只调 askLeave()（leaveAsk.ts）。
import { tz } from "../../i18n/zhOnly";
import { useGame } from "../../store/game";
import { ConfirmDialog } from "../feedback/ConfirmDialog";
import { useLeaveAsk } from "./leaveAsk";

export function LeaveConfirmHost() {
  const open = useLeaveAsk((s) => s.open);
  const close = () => useLeaveAsk.setState({ open: false });
  return (
    <ConfirmDialog
      open={open}
      title={tz("leave.title")}
      body={tz("leave.body")}
      confirmLabel={tz("leave.ok")}
      onConfirm={() => {
        close();
        useGame.getState().leave();
      }}
      onCancel={close}
    />
  );
}
