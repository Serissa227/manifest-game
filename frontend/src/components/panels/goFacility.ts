// 从别的窗口一键去某个港口的某个设施（新界面的空状态“下一步”：舰队货舱空 → 去交易所，没有航海士 → 去酒馆）。
// 与港口街景点建筑、商队的“装卸货物”相同：选中那个地点、切到那个设施、打开港口窗口。
import type { PortPage } from "../../store/game";
import { useGame } from "../../store/game";
import { openWindow } from "../shell/shellState";

export function goFacility(loc: number, facility: PortPage): void {
  const g = useGame.getState();
  g.selectLoc(loc);
  g.setFacility(facility);
  openWindow("port");
}
