// 短乐句的时机（纯函数）：比较前后两次概览，看出这一刻发生了什么——
// - 出港：旗舰队从停靠变成在海上；入港：从海上变成停靠；
// - 发现：已发现的发现物总数增加（概览的 discovered_count；旧后端没有这个字段时不奏）；
// - 大赚：同一次更新里各舰队、商队的货物减少、现金增加，按减少的货物原来的平均成本算，这笔的利润够大。
// 同一刻有几件事时按优先级只奏一个（发现 > 大赚 > 入港 > 出港）。读档、新开局这类“不是同一局的连续两刻”不奏。
// 前端拿不到的事件（例如第一次到访某个港口、从仓库卖货的成本）不做。
import type { Overview } from "../ipc/types";
import type { CueId } from "./tracks/jingles";

/** “大赚”：利润至少 min 金币、至少是净资产的 worth、至少是这批货成本的 margin。 */
export const FORTUNE = { min: 1500, worth: 0.03, margin: 0.25 } as const;

/** 优先级：同一刻只奏排在前面的一个。 */
export const CUE_ORDER: readonly CueId[] = ["discover", "fortune", "arrive", "depart"];

/**
 * 卖货的利润：各舰队与商队减少的货物按原来的平均成本算作成本，现金的增加算作收入。
 * 现金没有增加、或没有货物减少时为 null（买货、转运、只是过了一天）。
 */
export function saleProfit(prev: Overview, next: Overview): { profit: number; cost: number } | null {
  const gain = next.cash - prev.cash;
  if (!(gain > 0)) return null;
  const holders = (o: Overview) => [...o.fleets.map((f) => [`f${f.id}`, f.cargo] as const), ...o.caravans.map((c) => [`c${c.id}`, c.cargo] as const)];
  const left = new Map<string, number>();
  for (const [id, cargo] of holders(next)) for (const l of cargo) left.set(`${id}:${l.good}`, (left.get(`${id}:${l.good}`) ?? 0) + l.qty);
  let cost = 0;
  for (const [id, cargo] of holders(prev)) {
    for (const l of cargo) {
      const now = left.get(`${id}:${l.good}`) ?? 0;
      if (now < l.qty) cost += (l.qty - now) * l.avg_cost;
    }
  }
  if (!(cost > 0)) return null;
  return { profit: gain - cost, cost };
}

/** 两次概览之间发生的、要奏短乐句的事（按 CUE_ORDER 排好）。 */
export function cuesOf(prev: Overview | null | undefined, next: Overview | null | undefined): CueId[] {
  if (!prev || !next) return [];
  if (prev.scenario !== next.scenario || next.day < prev.day || next.day - prev.day > 5) return [];
  const found = new Set<CueId>();
  const a = prev.fleets[0];
  const b = next.fleets[0];
  if (a && b && a.id === b.id) {
    if (a.docked !== null && b.docked === null) found.add("depart");
    if (a.docked === null && b.docked !== null) found.add("arrive");
  }
  if (typeof prev.discovered_count === "number" && typeof next.discovered_count === "number" && next.discovered_count > prev.discovered_count) found.add("discover");
  const sale = saleProfit(prev, next);
  if (sale && sale.profit >= Math.max(FORTUNE.min, prev.net_worth * FORTUNE.worth) && sale.profit >= sale.cost * FORTUNE.margin) found.add("fortune");
  return CUE_ORDER.filter((c) => found.has(c));
}
