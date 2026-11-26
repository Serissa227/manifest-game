// H06 喊话卡片的小状态：点中了哪条船；海图点击时用 pickHail 判断有没有点中能喊话的船。
import { create } from "zustand";
import type { NavShip } from "../../ipc/types";

interface HailStore {
  /** 点中的船（航行视图的船 id，如 "f3"、"p7"） */
  target: string | null;
  busy: boolean;
}

export const useHailStore = create<HailStore>(() => ({ target: null, busy: false }));

/** 海图上点了一下（格坐标）：点中了能喊话的船（0.8 格以内最近的一条）就打开卡片并返回 true（这一下不再拿来转舵）。 */
export function pickHail(ships: readonly { ship: NavShip; x: number; y: number }[], x: number, y: number): boolean {
  const hit = ships
    .filter((s) => s.ship.hail)
    .map((s) => ({ s, d: Math.hypot(s.x - x, s.y - y) }))
    .filter((h) => h.d <= 0.8)
    .sort((a, b) => a.d - b.d)[0];
  if (!hit) return false;
  useHailStore.setState({ target: hit.s.ship.id });
  return true;
}
