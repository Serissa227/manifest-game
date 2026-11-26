// 物品与拍卖（docs/UI-CONTRACT.md I4、I9）的纯逻辑：种类与装备槽的对应、分类与排序、稀有度、套装进度、拍卖的出价。
// 合法性（能不能买、能不能装、能不能出价）以后端为准；这里只帮界面挑选、排列与给缺省值。
import type { IconName } from "../../art/icons";
import type { AuctionLot, EquipSlot, ItemKind, ItemLine, WearerView } from "../../ipc/types";
import { ITEM_ICON_KEYS } from "./itemIcons";

/** 装备槽的顺序（纸娃娃从上到下、从左到右）。 */
export const SLOTS: readonly EquipSlot[] = ["weapon", "sidearm", "outfit", "accessory1", "accessory2", "instrument", "focus"];

/** 某种物品能放进哪些槽。 */
export function slotsFor(kind: ItemKind): EquipSlot[] {
  switch (kind) {
    case "weapon":
      return ["weapon"];
    case "sidearm":
      return ["sidearm"];
    case "outfit":
      return ["outfit"];
    case "accessory":
      return ["accessory1", "accessory2"];
    case "instrument":
      return ["instrument"];
    case "focus":
      return ["focus"];
    default:
      return [];
  }
}

export const isEquipment = (kind: ItemKind): boolean => slotsFor(kind).length > 0;

/** 装备一件饰品时放哪个槽：先找空的，都满了就换第一个。 */
export function slotToEquip(w: WearerView, item: ItemLine): EquipSlot | null {
  const options = slotsFor(item.kind);
  if (options.length === 0) return null;
  const empty = options.find((s) => !w.slots.find((x) => x.slot === s)?.item);
  return empty ?? options[0];
}

/** 物品栏的分类（顺序固定）：装备、书、礼物与手作、消耗品、藏品与海图、关键物品。 */
export type ItemFilter = "all" | "gear" | "book" | "gift" | "consumable" | "curio" | "key";
export const FILTERS: readonly ItemFilter[] = ["all", "gear", "book", "gift", "consumable", "curio", "key"];

export function matches(f: ItemFilter, it: ItemLine): boolean {
  switch (f) {
    case "all":
      return true;
    case "gear":
      return isEquipment(it.kind);
    case "book":
      return it.kind === "book";
    case "gift":
      return it.kind === "gift";
    case "consumable":
      return it.kind === "consumable";
    case "curio":
      return it.kind === "curio" || it.kind === "chart";
    case "key":
      return it.key_item || it.kind === "key";
  }
}

/** 排序：稀有度高的在前，同稀有度按种类、再按名字。 */
const KIND_ORDER: readonly ItemKind[] = ["weapon", "sidearm", "outfit", "accessory", "instrument", "focus", "book", "gift", "consumable", "curio", "chart", "key"];
export function sortItems(list: ItemLine[]): ItemLine[] {
  return [...list].sort(
    (a, b) => b.rarity - a.rarity || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name, "zh-CN"),
  );
}

/** 没有专属图标时按种类取一个通用图标。 */
export function kindIcon(kind: ItemKind): IconName {
  switch (kind) {
    case "weapon":
    case "sidearm":
      return "battle";
    case "outfit":
      return "crew";
    case "accessory":
      return "star";
    case "instrument":
      return "music";
    case "focus":
      return "relic";
    case "book":
      return "report";
    case "gift":
      return "morale";
    case "consumable":
      return "food";
    case "curio":
      return "relic";
    case "chart":
      return "map";
    case "key":
      return "quest";
  }
}

/** 套装进度的文字比例。 */
export function setProgress(have: number, total: number): number {
  return total > 0 ? Math.max(0, Math.min(1, have / total)) : 0;
}

/** 拍卖：缺省的下一口（当前价加一个加价幅度，或底价；后端给的 next_min 为准）。 */
export function defaultBid(lot: Pick<AuctionLot, "next_min" | "current" | "reserve" | "increment">): number {
  if (lot.next_min > 0) return lot.next_min;
  return lot.current !== null ? lot.current + lot.increment : lot.reserve;
}

/** 拍卖：把玩家输入的出价规整成合法的一口（不低于 next_min，按加价幅度向上取整）；现金不够时返回 null。 */
export function normalizeBid(amount: number, lot: Pick<AuctionLot, "next_min" | "current" | "reserve" | "increment">, cash: number): number | null {
  const min = defaultBid(lot);
  if (!Number.isFinite(amount) || amount < min) amount = min;
  const step = Math.max(1, lot.increment);
  const v = min + Math.ceil((amount - min) / step) * step;
  return v > cash ? null : v;
}

const ICON_KEYS: ReadonlySet<string> = new Set(ITEM_ICON_KEYS);

/**
 * 物品的专属图标（public/items/<key>.webp，tools/items/draw.py 生成）：先看后端给的 icon，再看物品 key；
 * 名匠作（<原 key>_master）沿用原物品的图标；书先找自己的图（名著），再按类别共用封面（book_<类别>）。都没有时为 null，界面用种类的像素图标。
 */
export function itemIconKey(item: Pick<ItemLine, "key" | "icon" | "kind" | "book">): string | null {
  for (const k of [item.icon, item.key, item.key.replace(/_master$/, "")]) if (k && ICON_KEYS.has(k)) return k;
  if (item.kind === "book" && item.book) {
    const c = `book_${item.book.category}`;
    if (ICON_KEYS.has(c)) return c;
  }
  return null;
}

