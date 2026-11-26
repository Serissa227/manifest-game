// E03F 隐秘货不提前露面：静态货物表全量下发，前端要列货时一律从这里过一遍。
// 规则：secret 为真、编号又不在 Overview.revealed 里的货不列；其余（包括旧后端没有 secret 字段的）照列。
import type { GoodView } from "./types";

/** 这种货现在能不能在界面上列出来。 */
export function goodVisible(good: GoodView | null | undefined, revealed?: readonly number[] | null): boolean {
  if (!good) return false;
  return !good.secret || (revealed?.includes(good.id) ?? false);
}

/** 从静态货物表里挑出能列出来的货（顺序不变）。 */
export function visibleGoods(goods: readonly GoodView[], revealed?: readonly number[] | null): GoodView[] {
  return goods.filter((g) => goodVisible(g, revealed));
}
