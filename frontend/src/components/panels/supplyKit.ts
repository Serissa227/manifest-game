// 粮水（V01 补给按船员人日累计）：能撑几天、补到 N 天要买多少、花多少、这趟出航还差多少——
// 舰队页、购买补给、出航确认、航行状态、手动航行的出港框共用；buySupplies 买好以后在提示条里回一句。
// 后端给了 V01 的字段就照用（舰队的 supplies_days、supplies_for_10/30_days、daily_need_milli，sail_preview 的 shortfall）；
// 旧后端没有这些字段时按原来的算法（每天粮、水各吃 daily_need 份）推算，结果与改之前相同。
// 花费按固定价（rules.food_price / water_price）估：口粮实际在当地市场买（内核 provisions_quote），价钱随行情上下，所以界面写“约”。
import { listJoin, money } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import type { FleetView, RulesView, SailPreview, SupplyPair } from "../../ipc/types";
import { useGame } from "../../store/game";

type PriceRules = Pick<RulesView, "food_price" | "water_price">;
type RationRules = Pick<RulesView, "crew_per_supply_unit" | "fractional_supplies">;

/** 一键补到的两档天数（后端给了这两档的库存目标）。 */
export const SUPPLY_PRESETS = [10, 30] as const;
export type SupplyPreset = (typeof SUPPLY_PRESETS)[number];

/** 现有粮水能完整撑几天（按较少的那项）；没有船员、不消耗时为 null。 */
export function supplyDays(f: FleetView): number | null {
  if (f.supplies_days !== undefined) return f.supplies_days;
  return f.daily_need > 0 ? Math.floor(Math.min(f.food, f.water) / f.daily_need) : null;
}

/** 平均每天粮、水各用多少份（累计规则下多是小数）。 */
export function dailyUse(f: FleetView): number {
  return f.daily_need_milli !== undefined ? f.daily_need_milli / 1000 : Math.max(0, f.daily_need);
}

/** 够 n 天时粮、水各应有多少份（库存目标，含已经打开、吃了一部分的那份）。 */
export function supplyTarget(f: FleetView, n: SupplyPreset): number {
  const v = n === 10 ? f.supplies_for_10_days : f.supplies_for_30_days;
  return v ?? n * Math.max(0, f.daily_need);
}

/** 补到够 n 天：粮、水各要买多少（目标减库存，不少于 0）；已经够了、或不消耗时都是 0。 */
export function topUpTo(f: FleetView, n: SupplyPreset): SupplyPair {
  const days = supplyDays(f);
  if (days === null || days >= n) return { food: 0, water: 0 };
  const target = supplyTarget(f, n);
  return { food: Math.max(0, target - f.food), water: Math.max(0, target - f.water) };
}

/** 约花多少（固定价估算）。 */
export function supplyCost(rules: PriceRules, p: SupplyPair): number {
  return p.food * rules.food_price + p.water * rules.water_price;
}

/** 舱位还剩多少（粮水各占一格）。 */
export function freeRoom(f: FleetView): number {
  return Math.max(0, f.capacity - f.used);
}

/** 一次买这些粮水为什么不行：舱位不够（room）、现金不够（cash）。 */
export type SupplyBlock = { kind: "room"; need: number; free: number } | { kind: "cash"; cost: number; cash: number };

/** 买得了时为 null；舱位与现金都不够时先说舱位（内核也先查舱位）。 */
export function supplyBlock(f: FleetView, rules: PriceRules, p: SupplyPair, cash: number): SupplyBlock | null {
  const need = p.food + p.water;
  const free = freeRoom(f);
  if (need > free) return { kind: "room", need, free };
  const cost = supplyCost(rules, p);
  if (cost > cash) return { kind: "cash", cost, cash };
  return null;
}

/**
 * 买了 add 之后大约够几天。累计规则下不知道打开的那份已经吃掉多少，按偏少的一边估（最多少算一天）：
 * 每一项现有的人日不少于“可撑天数 × 船员”，也不少于“份数 × 每份人日 − (每份人日 − 1)”。没有船员时为 null。
 */
export function daysAfter(f: FleetView, rules: RationRules, add: SupplyPair): number | null {
  const now = supplyDays(f);
  if (now === null) return null;
  if (rules.fractional_supplies && f.supplies_days !== undefined && f.crew > 0) {
    const per = Math.max(1, rules.crew_per_supply_unit);
    const low = (stock: number) => Math.max(now * f.crew, stock > 0 ? stock * per - per + 1 : 0);
    const side = (stock: number, extra: number) => Math.floor((low(stock) + extra * per) / f.crew);
    return Math.min(side(f.food, add.food), side(f.water, add.water));
  }
  return f.daily_need > 0 ? Math.floor(Math.min(f.food + add.food, f.water + add.water) / f.daily_need) : null;
}

/** 只看一项（粮或水）大约够几天：旧界面的“粮 10（约 10 天）”用。没有船员时有库存写 99（同改之前）。 */
export function stockDays(f: FleetView, rules: RationRules, stock: number): number {
  const now = supplyDays(f);
  if (rules.fractional_supplies && f.supplies_days !== undefined) {
    if (now === null || f.crew <= 0) return stock > 0 ? 99 : 0;
    const per = Math.max(1, rules.crew_per_supply_unit);
    return Math.max(now, Math.floor(Math.max(0, stock * per - per + 1) / f.crew));
  }
  return f.daily_need > 0 ? Math.floor(stock / f.daily_need) : stock > 0 ? 99 : 0;
}

/** 这趟本身还差多少粮、水（不含余量）：后端给了就照用，旧后端按“天数 × 每天各需 − 库存”推算。 */
export function tripShortfall(f: FleetView, p: SailPreview): SupplyPair {
  if (p.shortfall) return p.shortfall;
  const need = p.days * Math.max(0, f.daily_need);
  return { food: Math.max(0, need - f.food), water: Math.max(0, need - f.water) };
}

/** 粮水撑不到这趟走完。 */
export function tripShort(f: FleetView, p: SailPreview): boolean {
  const s = tripShortfall(f, p);
  return s.food + s.water > 0;
}

/**
 * FIX5F：这一程的预计天数大于现有粮水够用的天数（定下一程的地方都用它：出航确认、自动航行的目的地、航线预览、行程下一站）。
 * 不耗粮水（没有船员，null）、天数不明（开到已知海域的边缘，null）时为 false。
 */
export function legOver(days: number | null | undefined, have: number | null | undefined): boolean {
  return typeof days === "number" && typeof have === "number" && days > have;
}

/** “粮水只够 N 天，这一程要走 M 天上下。”；atSea 为 true 时（没处买）再跟一句“近处有港先靠一靠”。 */
export function legOverText(days: number, have: number, atSea = false): string {
  const s = tz("sup.legOver", { days, have });
  return atSea ? `${s}${tz("sup.legOverSea")}` : s;
}

/** 补到这趟的建议量（含几天余量）要买的粮水。 */
export function toSuggested(f: FleetView, p: SailPreview): SupplyPair {
  return { food: Math.max(0, p.supplies - f.food), water: Math.max(0, p.supplies - f.water) };
}

/**
 * 就地补足：买多少、约花多少。margin 为 true 时补到建议量（多留余量）；false 时只补齐这趟的缺口，limit 是为什么不能多留（钱 / 舱位）；
 * 连缺口也补不了时 block 写明为什么（按钮不可用）。
 */
export interface FillPlan {
  buy: SupplyPair;
  cost: number;
  margin: boolean;
  limit: SupplyBlock["kind"] | null;
  block: SupplyBlock | null;
}

/** 先补到建议量；钱或舱位不够时退一步只补齐缺口。 */
export function fillPlan(f: FleetView, rules: PriceRules, p: SailPreview, cash: number): FillPlan {
  const full = toSuggested(f, p);
  const fullBlock = supplyBlock(f, rules, full, cash);
  if (!fullBlock) return { buy: full, cost: supplyCost(rules, full), margin: true, limit: null, block: null };
  const gap = tripShortfall(f, p);
  if (gap.food + gap.water === 0) return { buy: full, cost: supplyCost(rules, full), margin: true, limit: null, block: fullBlock };
  return { buy: gap, cost: supplyCost(rules, gap), margin: false, limit: fullBlock.kind, block: supplyBlock(f, rules, gap, cash) };
}

// ───────────────────────────── 文字 ─────────────────────────────

/** “粮 2、水 1”（为 0 的一项不写）；两项都是 0 时为空串。sign 为 true 时写成“粮 +2”。 */
export function pairText(p: SupplyPair, sign = false): string {
  const parts: string[] = [];
  if (p.food > 0) parts.push(tz("sup.food", { n: sign ? `+${p.food}` : p.food }));
  if (p.water > 0) parts.push(tz("sup.water", { n: sign ? `+${p.water}` : p.water }));
  return listJoin(parts);
}

/** “粮 2 / 水 2，够 3 天”；onboard 为 true 时前面加“船上”。没有船员时写不耗粮水。 */
export function haveText(f: FleetView, onboard = false): string {
  const days = supplyDays(f);
  const vars = { food: f.food, water: f.water, n: days ?? 0 };
  if (days === null) return tz(onboard ? "sup.onboardIdle" : "sup.haveIdle", vars);
  return tz(onboard ? "sup.onboard" : "sup.have", vars);
}

/** 这趟还差多少的那一句：“这趟约 5 天，粮水只够 3 天，还差粮 1、水 1。” */
export function shortText(f: FleetView, p: SailPreview): string {
  return tz("sup.short", { days: p.days, have: supplyDays(f) ?? 0, gap: pairText(tripShortfall(f, p)) });
}

/** 买不了的原因（一键补到 n 天的按钮下面那一行）。 */
export function presetBlockText(n: number, b: SupplyBlock): string {
  return b.kind === "room"
    ? tz("sup.presetRoom", { n, need: b.need, free: b.free })
    : tz("sup.presetCash", { n, cost: money(b.cost), cash: money(b.cash) });
}

/** 就地补足的下一行：补到建议量 / 只补齐缺口（为什么）/ 补不了（为什么）。 */
export function fillNote(plan: FillPlan, suggested: number): string {
  if (plan.block) {
    return plan.block.kind === "room"
      ? tz("sup.fillRoom", { need: plan.block.need, free: plan.block.free })
      : tz("sup.fillCash", { cost: money(plan.block.cost), cash: money(plan.block.cash) });
  }
  if (plan.margin) return tz("sup.fillMargin", { n: suggested });
  return tz(plan.limit === "room" ? "sup.fillGapRoom" : "sup.fillGapCash");
}

// ───────────────────────────── 买 ─────────────────────────────

/**
 * 买粮水并在提示条里回一句：花了多少按买前买后的现金差算（口粮按当地市价买，比估算准），现在够几天照后端的新数。
 * 返回是否买成；被内核拒绝时提示条里是内核给的原因（store 的 submit 统一处理）。
 */
export async function buySupplies(fleetId: number, buy: SupplyPair, estimate: number): Promise<boolean> {
  const g = useGame.getState();
  const before = g.overview?.cash ?? 0;
  const r = await g.submit({ Resupply: { owner: "player", fleet: fleetId, food: buy.food, water: buy.water } });
  if (!r) return false;
  const spent = before - r.overview.cash;
  const after = r.overview.fleets.find((f) => f.id === fleetId);
  const days = after ? supplyDays(after) : null;
  const vars = { what: pairText(buy, true), cost: money(spent > 0 ? spent : estimate), n: days ?? 0 };
  useGame.getState().notify(days === null ? tz("sup.boughtShort", vars) : tz("sup.bought", vars));
  return true;
}
