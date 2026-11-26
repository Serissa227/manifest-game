// 船厂出售的船型：去掉独有船型（ShipTypeView.unique：船厂不出售，NPC 不使用）与不存在的船型。
import type { ShipTypeView, StaticView } from "../../ipc/types";

/** 独有船型：船厂不出售，NPC 不使用。 */
export function isUniqueShip(s: ShipTypeView | undefined): boolean {
  return s?.unique === true;
}

/** 船厂可以出售的船型（后端也会过滤，这里再保险一次）。 */
export function saleShips(statics: StaticView, ids: readonly number[]): number[] {
  return ids.filter((id) => statics.ships[id] !== undefined && !isUniqueShip(statics.ships[id]));
}
