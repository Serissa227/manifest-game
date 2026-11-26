// 市场驱动分解（docs/ECONOMY.md 4.7(b)）：内核的价格 = 基准价 × f(库存 / 目标库存) × 需求系数（再夹到上下限），
// 所以从起点到第 t 天，价格的对数变化可以按公式拆开：
//   需求系数：季节、事件、流行三项的对数变化；
//   库存：玩家买卖、委托交付、商会买卖、做市方成交、本地商人的存货进出、正常产销（产出减消耗）、城镇工坊（取走原料、放回产出）、
//         事件带来的产量变化——库存的总影响按价格曲线在两端之间的弧斜率分摊到各项库存变动上（各项之和正好等于总影响）；
//   目标库存的变化：需求（人口与繁荣，ECONOMY.md 6.4）、替代品的价格，其余记为市场规模（发展度）——
//         目标库存的总影响按对数变化分摊到各分量上；
//   当地钱袋（货币流通，ECONOMY.md 6.9）：报价乘流动性系数，它的对数变化单独一项；
//   价格上下限截断，以及整数取整的余量。
// 各项（对数）之和等于实际价格的对数变化。

import type { TrackDayView } from "../ipc/types";

export type DriverKey =
  | "season"
  | "event_demand"
  | "popular"
  | "player"
  | "delivered"
  | "npc"
  | "hoard"
  | "other"
  | "production"
  | "workshop"
  | "event_supply"
  | "people"
  | "substitute"
  | "target"
  | "liquidity"
  | "clamp"
  | "rounding";

export interface Driver {
  key: DriverKey;
  /** 对价格的对数影响 */
  effect: number;
  /** 约合百分比：100 × (e^effect − 1) */
  pct: number;
  /** 库存类驱动：带来的库存变化（件，正数为库存增加） */
  units?: number;
}

export interface Attribution {
  /** 起点与终点的日期、价格 */
  fromDay: number;
  toDay: number;
  from: number;
  to: number;
  /** 价格的对数变化与约合百分比 */
  total: number;
  pct: number;
  /** 按影响大小排序（去掉可以忽略的项） */
  drivers: Driver[];
  /** 全部项（含可以忽略的），测试核对恒等式用 */
  all: Driver[];
  /** 起点不是内核的完整记录时，从第一天开始分解 */
  approximate: boolean;
}

/** 价格曲线（万分之一的 [比例, 系数] 点）按内核的分段线性求值。 */
export function curveAt(curve: readonly [number, number][], ratio: number): number {
  if (curve.length === 0) return 1;
  const x = ratio * 10_000;
  if (x <= curve[0][0]) return curve[0][1] / 10_000;
  for (let i = 1; i < curve.length; i++) {
    const [x0, y0] = curve[i - 1];
    const [x1, y1] = curve[i];
    if (x <= x1) {
      const span = x1 - x0;
      return (span > 0 ? y0 + ((y1 - y0) * (x - x0)) / span : y1) / 10_000;
    }
  }
  return curve[curve.length - 1][1] / 10_000;
}

const lnf = (curve: readonly [number, number][], r: number) => Math.log(Math.max(1e-9, curveAt(curve, Math.max(0, r))));

export interface AttributionInput {
  baseline: TrackDayView;
  baselineExact: boolean;
  /** 起点之后逐日的实际情况 */
  track: readonly TrackDayView[];
  curve: readonly [number, number][];
  popularBonusBp: number;
}

/** 可以忽略的影响（对数）：约 0.5%。 */
export const NEGLIGIBLE = 0.005;

/** 从起点分解到第 t 步（1 起）。 */
export function attribute(input: AttributionInput, t: number): Attribution | null {
  const { track, curve } = input;
  if (t < 1 || t > track.length) return null;
  // 起点不完整（记下之前当天已有成交）时，从第 1 步开始分解
  const approximate = !input.baselineExact || input.baseline.demand_bp <= 0;
  const start = approximate ? track[0] : input.baseline;
  const firstStep = approximate ? 1 : 0;
  const end = track[t - 1];
  if (approximate && t === 1) return null;
  const total = Math.log(end.price / start.price);
  const bonus = input.popularBonusBp / 10_000;
  const lr = (a: number, b: number) => (a > 0 && b > 0 ? Math.log(a / b) : 0);

  // 需求系数
  const season = lr(end.season_bp, start.season_bp);
  const eventDemand = lr(end.event_bp, start.event_bp);
  const popular = Math.log((1 + (end.popular ? bonus : 0)) / (1 + (start.popular ? bonus : 0)));

  // 库存：各项库存变动（收盘到收盘；商会与做市方的成交发生在收盘之后，算前一天的）
  const T0 = Math.max(1, start.target);
  let player = 0;
  let delivered = 0;
  let npc = 0;
  let hoard = 0;
  let other = 0;
  // 正常产销：正常产出减去消耗（库存向均衡回归的那部分，也是模型本该看得出的部分）
  let production = 0;
  let workshop = 0;
  let eventSupply = 0;
  const days = track.slice(firstStep, t);
  const before = [start, ...days.slice(0, -1)];
  for (const d of days) {
    player += d.player_sold - d.player_bought;
    delivered += d.delivered ?? 0;
    workshop += (d.workshop_out ?? 0) - (d.workshop_in ?? 0);
    const es = d.event_supply_bp > 0 ? d.event_supply_bp / 10_000 : 1;
    const fromEvent = es !== 1 ? d.produced * (1 - 1 / es) : 0;
    eventSupply += fromEvent;
    production += d.produced - fromEvent - d.consumed;
  }
  for (const d of before) {
    npc += d.npc_sold - d.npc_bought;
    // 商人囤入让市场库存减少（抛售让它增加）
    hoard -= d.hoarded ?? 0;
    other += d.other_sold - d.other_bought;
  }
  const s0 = start.stock_close;
  const st = end.stock_close;
  const ds = st - s0;
  // 库存变动的余量（近似起点、或旧数据）记到“其他”
  other += ds - (player + delivered + npc + hoard + other + production + workshop + eventSupply);
  const stockEffect = lnf(curve, st / T0) - lnf(curve, s0 / T0);
  const r0 = s0 / T0;
  let k: number;
  if (Math.abs(ds) >= 0.5) {
    k = stockEffect / (ds / T0);
  } else {
    const h = 0.01;
    k = (lnf(curve, r0 + h) - lnf(curve, Math.max(0, r0 - h))) / (r0 + h - Math.max(0, r0 - h));
  }
  const byStock = (units: number) => (k * units) / T0;
  const targetEffect = lnf(curve, st / Math.max(1, end.target)) - lnf(curve, st / T0);
  // 目标库存的分量：需求（人口比例 × 繁荣度的需求层级系数）与替代系数的对数变化，按目标库存对价格的斜率折算；
  // 其余（发展度与取整）记为市场规模。斜率取两端之间的弧斜率，目标库存几乎没变时取当地的导数
  const logT = Math.log(Math.max(1, end.target) / T0);
  let kT: number;
  if (Math.abs(logT) >= 1e-4) {
    kT = targetEffect / logT;
  } else {
    const h = 0.01;
    kT = (lnf(curve, (st / T0) * Math.exp(-h)) - lnf(curve, (st / T0) * Math.exp(h))) / (2 * h);
  }
  const bp = (v: number | undefined) => (v && v > 0 ? v : 10_000);
  const people = kT * (lr(bp(end.people_bp), bp(start.people_bp)) + lr(bp(end.prosperity_bp), bp(start.prosperity_bp)));
  const substitute = kT * lr(bp(end.substitute_bp), bp(start.substitute_bp));
  const target = targetEffect - people - substitute;

  // 当地钱袋：流动性系数的对数变化（没有记录时为 1）
  const liquidity = lr(bp(end.liquidity_bp), bp(start.liquidity_bp));
  // 余量：价格被夹在上下限时记为“上下限”，否则是整数价格与定点系数的取整余量
  const explained = season + eventDemand + popular + stockEffect + targetEffect + liquidity;
  const clampOrRound = total - explained;
  const clamped = start.clamped !== 0 || end.clamped !== 0;

  const mk = (key: DriverKey, effect: number, units?: number): Driver => ({ key, effect, pct: 100 * (Math.exp(effect) - 1), units });
  const all: Driver[] = [
    mk("season", season),
    mk("event_demand", eventDemand),
    mk("popular", popular),
    mk("player", byStock(player), player),
    mk("delivered", byStock(delivered), delivered),
    mk("npc", byStock(npc), npc),
    mk("hoard", byStock(hoard), hoard),
    mk("other", byStock(other), other),
    mk("production", byStock(production), Math.round(production)),
    mk("workshop", byStock(workshop), workshop),
    mk("event_supply", byStock(eventSupply), Math.round(eventSupply)),
    mk("people", people),
    mk("substitute", substitute),
    mk("target", target),
    mk("liquidity", liquidity),
    mk(clamped ? "clamp" : "rounding", clampOrRound),
  ];
  const drivers = all.filter((d) => Math.abs(d.effect) >= NEGLIGIBLE).sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  return {
    fromDay: start.day,
    toDay: end.day,
    from: start.price,
    to: end.price,
    total,
    pct: 100 * (Math.exp(total) - 1),
    drivers,
    all,
    approximate,
  };
}

/** 外部冲击（模型无从知道的变化）与正常的产销回归。 */
export const SHOCKS: readonly DriverKey[] = [
  "season",
  "event_demand",
  "popular",
  "player",
  "delivered",
  "npc",
  "hoard",
  "other",
  "event_supply",
  "people",
  "substitute",
  "target",
  "liquidity",
  "clamp",
];
