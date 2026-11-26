// 交易所的计算与成交（界面见 Market.tsx）：持有者与装载、一件的估算成交价、最多可买几件、买不了的原因、
// 成交单（一次结算多种货物）的增删与合计、询价后成交。这里只有纯函数与对内核命令的封装，不含界面状态。
// 成交一律经内核的询价（quote）与命令（Buy / Sell / BuyInto / SellFrom），限价在询价上放宽 3%，由内核最终裁决。
import { t } from "../../i18n";
import { api } from "../../ipc/api";
import type { BookView, CargoLine, Command, FleetView, GoodView, Holder, MarketRow, Overview, PortView, SeriesView, StaticView, TradeQuote } from "../../ipc/types";
import { useGame } from "../../store/game";

export type Side = "buy" | "sell";

/** 成交前重新询价后，限价在询价上放宽的比例。 */
export const SLIPPAGE = 0.03;

/** 可以在这里交易的持有者（舰队、商队、本地仓库）。 */
export interface HolderOpt {
  value: string;
  label: string;
  holder: Holder;
}

export function holderOptions(port: PortView): HolderOpt[] {
  const out: HolderOpt[] = [];
  for (const id of port.fleets_here) out.push({ value: `f${id}`, label: t("holder.fleet", { id }), holder: { Fleet: id } });
  for (const id of port.caravans_here) out.push({ value: `c${id}`, label: t("holder.caravan", { id }), holder: { Caravan: id } });
  if (port.warehouse.capacity > 0) out.push({ value: "w", label: t("holder.warehouse"), holder: { Warehouse: port.loc } });
  return out;
}

/** 持有者身上的货物与装载。 */
export interface Load {
  cargo: CargoLine[];
  used: number;
  capacity: number;
}

export function loadOf(o: Pick<Overview, "fleets" | "caravans"> | null, port: PortView, h: Holder): Load {
  if ("Fleet" in h) {
    const f = o?.fleets.find((x) => x.id === h.Fleet);
    return { cargo: f?.cargo ?? [], used: f?.used ?? 0, capacity: f?.capacity ?? 0 };
  }
  if ("Caravan" in h) {
    const c = o?.caravans.find((x) => x.id === h.Caravan);
    const cargo = c?.cargo ?? [];
    return { cargo, used: cargo.reduce((a, l) => a + l.qty, 0), capacity: c?.capacity ?? 0 };
  }
  return { cargo: port.warehouse.stock, used: port.warehouse.used, capacity: port.warehouse.capacity };
}

export function tradeCommand(holder: Holder, side: Side, good: number, qty: number, limit: number | null): Command {
  if ("Fleet" in holder) {
    return side === "buy"
      ? { Buy: { owner: "player", fleet: holder.Fleet, good, qty, max_total: limit } }
      : { Sell: { owner: "player", fleet: holder.Fleet, good, qty, min_total: limit } };
  }
  return side === "buy"
    ? { BuyInto: { owner: "player", holder, good, qty, max_total: limit } }
    : { SellFrom: { owner: "player", holder, good, qty, min_total: limit } };
}

/**
 * 一件的估算成交价（含交易税、议价与关税，不含成交量对价格的冲击）：卖出页的收购价、买入页的“买满”件数都用它。
 * 精确的金额以询价为准。
 */
export function unitEstimate(port: PortView, row: MarketRow, side: Side): number {
  const tariff = (side === "buy" ? row.export_tax_bp : row.import_tax_bp) ?? 10_000;
  const tax = (port.tax_bp / 10_000) * (tariff / 10_000);
  const bargain = port.bargain ? port.bargain[0] : 0;
  if (side === "buy") return row.price * (1 - bargain) * (1 + tax);
  return Math.max(0, row.price * (1 + bargain / 2) * (1 - tax));
}

/** 最多能买几件，以及卡在哪里（现金、舱位、库存）。 */
export function maxBuy(port: PortView, row: MarketRow, cash: number, free: number): { qty: number; limit: "cash" | "space" | "stock" } {
  const unit = unitEstimate(port, row, "buy");
  const byCash = unit > 0 ? Math.floor(cash / unit) : Number.MAX_SAFE_INTEGER;
  const options: [number, "cash" | "space" | "stock"][] = [
    [Math.max(0, byCash), "cash"],
    [Math.max(0, free), "space"],
    [Math.max(0, row.stock), "stock"],
  ];
  options.sort((a, b) => a[0] - b[0]);
  return { qty: options[0][0], limit: options[0][1] };
}

// ───────────────────────────── 成交量对价格的冲击（估算） ─────────────────────────────

/**
 * 价格曲线与上下限：取自这个港口任意一种货的行情序列（SeriesView.curve 是全局规则 rules.toml 的价格曲线，
 * [库存 / 目标库存, 系数] 都是万分之一；上下限是相对基准价的倍数）。只用来估算“买满”的件数与成交单里还没询到价的行，
 * 真正成交的金额以询价为准。
 */
export interface PriceCurve {
  points: readonly (readonly [number, number])[];
  floor: number;
  cap: number;
}

export function curveFrom(s: SeriesView | null | undefined): PriceCurve | null {
  if (!s || !s.curve || s.curve.length === 0 || s.base_price <= 0) return null;
  return { points: s.curve, floor: s.floor / s.base_price, cap: s.cap / s.base_price };
}

/** 曲线在 x（万分之一）处的值（万分之一）：分段线性，两端取端点值（与内核 PiecewiseCurve::eval 相同）。 */
function evalCurve(points: PriceCurve["points"], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (x <= x1) return x1 > x0 ? y0 + ((y1 - y0) * (x - x0)) / (x1 - x0) : y1;
  }
  return points[points.length - 1][1];
}

/**
 * 买入 qty 件的估算合计（含税、议价与关税）：与内核一样沿库存分至多 40 段走价、每段取中点的价格，
 * 现价里的季节、事件、流行与钱袋等系数从现价反推，照样乘上。
 */
export function buyCostEstimate(port: PortView, row: MarketRow, qty: number, curve: PriceCurve): number {
  if (qty <= 0) return 0;
  const base = row.base_price;
  const target = Math.max(1, row.target);
  const f = (stock: number) => evalCurve(curve.points, (stock * 10_000) / target) / 10_000;
  const f0 = f(row.stock);
  const mult = f0 > 0 && base > 0 ? row.price / (base * f0) : 1;
  const lo = Math.max(1, base * curve.floor);
  const hi = Math.max(lo, base * curve.cap);
  const steps = Math.min(Math.max(qty, 1), 40);
  const chunk = Math.floor(qty / steps);
  const extra = qty % steps;
  let stock = row.stock;
  let gross = 0;
  for (let i = 0; i < steps; i++) {
    const c = chunk + (i < extra ? 1 : 0);
    if (c === 0) continue;
    const unit = Math.min(hi, Math.max(lo, base * f(stock - c / 2) * mult));
    gross += unit * c;
    stock -= c;
  }
  return gross * (unitEstimate(port, row, "buy") / Math.max(1e-9, row.price));
}

/**
 * 考虑成交量对价格的冲击，最多能买几件以及卡在哪里：舱位与库存是硬上限，现金按沿库存走价的估算二分查找。
 * 没有价格曲线时退回 maxBuy（按现价估算）。
 */
export function maxBuyImpact(port: PortView, row: MarketRow, cash: number, free: number, curve: PriceCurve | null): { qty: number; limit: "cash" | "space" | "stock" } {
  if (!curve) return maxBuy(port, row, cash, free);
  const hard = Math.max(0, Math.min(free, row.stock));
  const hardLimit: "space" | "stock" = free <= row.stock ? "space" : "stock";
  if (hard === 0) return { qty: 0, limit: hardLimit };
  if (buyCostEstimate(port, row, hard, curve) <= cash) return { qty: hard, limit: hardLimit };
  let lo = 0;
  let hi = hard;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (buyCostEstimate(port, row, mid, curve) <= cash) lo = mid;
    else hi = mid;
  }
  return { qty: lo, limit: "cash" };
}

/**
 * 与件数无关、这里根本买不了的原因（内核同样会拒绝）：势力禁止运出（禁运），军需品没有当地势力的许可证，
 * 或货档高过你在这里的商誉（T01：行会只把好货卖给熟客和在本地设了商馆的人），
 * 或本港有未结的委托要这种货、托运期间谁都买不到（T04b，内核拒绝码 market.reserved；卖出与交货照常）。
 * 件数上的限制（现金、舱位、库存）见 maxBuy。
 */
export type BuyBlock = "banned" | "license" | "reserved" | "rank";

export function buyBlock(port: PortView, row: MarketRow, good: GoodView | undefined): BuyBlock | null {
  if (row.banned) return "banned";
  if (good?.license && !port.office.license) return "license";
  if (row.reserved) return "reserved";
  if ((row.rank_short ?? 0) > 0) return "rank";
  return null;
}

/** 货档的叫法（0–3）：粗货、行货、细货、珍货。 */
export const RANK_KEYS = ["mk.rank.0", "mk.rank.1", "mk.rank.2", "mk.rank.3"] as const;

export function rankKey(rank: number): (typeof RANK_KEYS)[number] {
  return RANK_KEYS[Math.max(0, Math.min(RANK_KEYS.length - 1, Math.floor(rank)))];
}

/**
 * 这里出售这种货吗（开放市场：买入页只列出售的，以本地特产为主；别的货只收不卖）。
 * 旧后端的行没有 sold：那时市场里列出的货都能买。
 */
export function isSold(row: MarketRow): boolean {
  return row.sold !== false;
}

/** 这里出售的货（买入页的行），按交易所的顺序。 */
export function saleRows(port: PortView): MarketRow[] {
  return port.market.filter(isSold);
}

// ───────────────────────────── 别处的价格（明细） ─────────────────────────────

/** 别处最多问几处港口的价格（旧后端：每次询问都是一次请求）。 */
export const ELSEWHERE_MAX = 16;
/** 明细里列出几处。 */
export const ELSEWHERE_SHOWN = 3;

type Place = BookView["places"][number];

/**
 * 明细里“别处的价格”要问哪几处：自己知道行情的地方（预测簿的 places），不含这里。
 * 卖出页看全部（开放市场：哪里都收），买入页只看出售这种货的地方（places 没有 sold 的旧后端都算）。
 * 新后端给出各地所知的价格（prices）：卖出页贵的在前、买入页便宜的在前，只取列出的几处；旧后端按地点顺序取至多 16 处，问到行情后再排序。
 */
export function pickPlaces(places: readonly Place[], loc: number, good: number, side: Side): { places: Place[]; ranked: boolean } {
  const all = places.filter((p) => p.loc !== loc && p.goods.includes(good));
  const eligible = side === "buy" ? all.filter((p) => !p.sold || p.sold.includes(good)) : all;
  const priceOf = (p: Place) => p.prices?.[p.goods.indexOf(good)];
  const ranked = eligible.length > 0 && eligible.every((p) => priceOf(p) !== undefined);
  if (!ranked) return { places: eligible.slice(0, ELSEWHERE_MAX), ranked };
  const sorted = [...eligible].sort((a, b) => {
    const d = side === "buy" ? (priceOf(a) ?? 0) - (priceOf(b) ?? 0) : (priceOf(b) ?? 0) - (priceOf(a) ?? 0);
    return d !== 0 ? d : a.loc - b.loc;
  });
  return { places: sorted.slice(0, ELSEWHERE_SHOWN), ranked };
}

/** 这里卖不了的原因：此地不收（旧后端或开放市场关闭时的清单以外的货），或军需品没有当地势力的许可证（买卖都要）。 */
export type SellBlock = "notTraded" | "license";

export function sellBlock(port: PortView, row: MarketRow | undefined, good: GoodView | undefined): SellBlock | null {
  if (!row) return "notTraded";
  if (good?.license && !port.office.license) return "license";
  return null;
}

// ───────────────────────────── 查找与排序 ─────────────────────────────

/** 买入页的排序：默认（交易所的顺序）、比平常便宜的在前（相对基准价）、价格从低到高、库存从多到少。 */
export type BuySort = "default" | "cheap" | "price" | "stock";
/** 卖出页的排序：默认（此地收的在前）、盈利多的在前（按估价）、收购价从高到低。 */
export type SellSort = "default" | "profit" | "bid";

/** 商品是否与查找的文字相符：名字（当前语言与英文正名）、key、类别，不分大小写。空串都相符。 */
export function goodMatches(good: GoodView | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (!good) return false;
  return [good.name, good.name_en ?? "", good.key, good.category].some((s) => s.toLowerCase().includes(q));
}

export function sortBuyRows(rows: readonly MarketRow[], by: BuySort): MarketRow[] {
  const list = [...rows];
  const rel = (r: MarketRow) => (r.base_price > 0 ? r.price / r.base_price : 1);
  // 默认的顺序：货档锁着、眼下买不了的排到后面（各自仍按交易所的顺序）
  if (by === "default") return [...list.filter((r) => !((r.rank_short ?? 0) > 0)), ...list.filter((r) => (r.rank_short ?? 0) > 0)];
  if (by === "cheap") list.sort((a, b) => rel(a) - rel(b));
  else if (by === "price") list.sort((a, b) => a.price - b.price);
  else if (by === "stock") list.sort((a, b) => b.stock - a.stock);
  return list;
}

// ───────────────────────────── 成交单：一次结算多种货物 ─────────────────────────────

/** 成交单的一行：某种商品买或卖多少件。同一种商品只有一个方向（在买入页调数量会取消它在卖出页的数量，反之亦然）。 */
export interface CartLine {
  good: number;
  side: Side;
  qty: number;
}

/** 成交单：按商品编号。 */
export type Cart = Readonly<Record<number, CartLine>>;

export const EMPTY_CART: Cart = Object.freeze({});

/** 成交单里某种商品在某个方向上的件数（没有时为 0）。 */
export function lineQty(cart: Cart, good: number, side: Side): number {
  const l = cart[good];
  return l && l.side === side ? l.qty : 0;
}

/** 设定某行的件数：0 或负数删掉这一行；设定一个方向会取代这种商品另一个方向的数量。 */
export function withLine(cart: Cart, good: number, side: Side, qty: number): Cart {
  const n = Math.max(0, Math.floor(qty));
  const cur = cart[good];
  if (n === 0) {
    if (!cur || cur.side !== side) return cart;
    const next: Record<number, CartLine> = { ...cart };
    delete next[good];
    return next;
  }
  if (cur && cur.side === side && cur.qty === n) return cart;
  return { ...cart, [good]: { good, side, qty: n } };
}

/** 成交单的各行：先卖后买（卖出腾出的现金与舱位留给后面的买入），同一方向按商品编号。 */
export function cartLines(cart: Cart): CartLine[] {
  const lines = Object.values(cart).filter((l) => l.qty > 0);
  return [...lines.filter((l) => l.side === "sell"), ...lines.filter((l) => l.side === "buy")].sort(
    (a, b) => (a.side === b.side ? a.good - b.good : a.side === "sell" ? -1 : 1),
  );
}

/**
 * 按此刻的状况整理成交单：卖出不超过持有的件数，买入不超过库存与舱位（先卖后买，卖出腾出的空位算进去），
 * 此地不收、这里不出售（买入）、禁运、缺许可证的行去掉。成交单里存的是玩家调的数量，界面与合计一律用整理后的结果
 * （例如刚用“全卖”卖掉了某种货，或装载变了，成交单跟着收紧，不会提交做不到的数量）。
 */
export function normalize(cart: Cart, load: Load, rows: ReadonlyMap<number, MarketRow>, port: PortView, goods: readonly GoodView[]): Cart {
  const out: Record<number, CartLine> = {};
  let room = load.capacity - load.used;
  for (const l of cartLines(cart)) {
    const row = rows.get(l.good);
    const good = goods[l.good];
    if (l.side === "sell") {
      if (sellBlock(port, row, good)) continue;
      const held = load.cargo.find((c) => c.good === l.good)?.qty ?? 0;
      const q = Math.min(l.qty, held);
      if (q > 0) {
        out[l.good] = q === l.qty ? l : { ...l, qty: q };
        room += q;
      }
    } else {
      if (!row || !isSold(row) || buyBlock(port, row, good)) continue;
      const q = Math.min(l.qty, row.stock, Math.max(0, room));
      if (q > 0) {
        out[l.good] = q === l.qty ? l : { ...l, qty: q };
        room -= q;
      }
    }
  }
  return out;
}

/** 询价结果的键：同一行改了件数就是另一次询价。 */
export function quoteKey(l: CartLine): string {
  return `${l.side}:${l.good}:${l.qty}`;
}

/** 某种商品最多能在成交单里买几件：按库存与舱位（成交单里要卖的腾出空位，其他要买的先占着）。现金不在这里限制，由合计检查。 */
export function buyRoom(load: Load, cart: Cart, good: number, stock: number): number {
  let room = load.capacity - load.used;
  for (const l of Object.values(cart)) {
    if (l.side === "sell") room += l.qty;
    else if (l.good !== good) room -= l.qty;
  }
  return Math.max(0, Math.min(stock, room));
}

/** 成交单的合计：金额（询价到了用询价，否则用估价）、盈亏、成交后的现金与装载，以及现金、舱位够不够。 */
export interface CartSummary {
  /** 卖出、买入的行数 */
  sells: number;
  buys: number;
  sellTotal: number;
  buyTotal: number;
  /** 卖出这些货相对成本的盈亏 */
  profit: number;
  cashAfter: number;
  usedAfter: number;
  /** 每一行都有精确询价 */
  exact: boolean;
  /** 现金差多少（够时为 0） */
  shortCash: number;
  /** 舱位超出多少（放得下时为 0） */
  overSpace: number;
}

export function summarize(
  lines: readonly CartLine[],
  quoteOf: (l: CartLine) => TradeQuote | undefined,
  estimateOf: (l: CartLine) => number,
  cash: number,
  load: Load,
): CartSummary {
  let sellTotal = 0;
  let buyTotal = 0;
  let profit = 0;
  let exact = true;
  let used = load.used;
  let sells = 0;
  let buys = 0;
  for (const l of lines) {
    const q = quoteOf(l);
    if (!q) exact = false;
    const total = q ? q.total : Math.round(estimateOf(l));
    if (l.side === "sell") {
      sells += 1;
      sellTotal += total;
      used -= l.qty;
      const cost = load.cargo.find((c) => c.good === l.good)?.avg_cost ?? 0;
      profit += total - cost * l.qty;
    } else {
      buys += 1;
      buyTotal += total;
      used += l.qty;
    }
  }
  const cashAfter = cash + sellTotal - buyTotal;
  return {
    sells,
    buys,
    sellTotal,
    buyTotal,
    profit,
    cashAfter,
    usedAfter: used,
    exact,
    shortCash: Math.max(0, -cashAfter),
    overSpace: Math.max(0, used - load.capacity),
  };
}

// ───────────────────────────── 船厂：卖船 ─────────────────────────────

/** 这艘船为什么卖不了（与内核 SellShip 的校验一致：独有船型、只剩一艘、卖了装不下货或船员太多）；卖得了时为 null。 */
export function sellShipBlock(statics: StaticView, fleet: FleetView, index: number): string | null {
  const s = fleet.ships[index];
  if (!s) return null;
  const type = statics.ships[s.kind];
  if (type?.unique) return t("sy.noSellUnique");
  if (fleet.ships.length <= 1) return t("sy.noSellLast");
  const over = fleet.used - (fleet.capacity - s.capacity);
  if (over > 0) return t("sy.noSellCargo", { n: over });
  const crewOver = fleet.crew - (fleet.crew_max - (type?.crew_max ?? 0));
  if (crewOver > 0) return t("sy.noSellCrew", { n: crewOver });
  return null;
}

// ───────────────────────────── 装卸：同一处两个持有者之间搬货 ─────────────────────────────

/** 搬货的方向：从左边到右边、从右边到左边（装卸台的两边）。 */
export type MoveDir = "lr" | "rl";

/** 要搬的数量：键为 moveKey（方向、商品）。 */
export type Moves = Readonly<Record<string, number>>;

export function moveKey(dir: MoveDir, good: number): string {
  return `${dir}:${good}`;
}

/**
 * 按两边此刻的货与空位整理要搬的数量：每行不超过持有，同一方向的合计不超过对面的空位（按商品编号先到先得）。
 * 两个方向各自放得下，所以提交的先后无妨（不指望对面先腾出空位）。
 */
export function fitMoves(moves: Moves, a: Load, b: Load): Moves {
  const out: Record<string, number> = {};
  for (const [dir, from, to] of [
    ["lr", a, b],
    ["rl", b, a],
  ] as const) {
    let room = Math.max(0, to.capacity - to.used);
    for (const line of [...from.cargo].sort((x, y) => x.good - y.good)) {
      const want = moves[moveKey(dir, line.good)] ?? 0;
      const n = Math.max(0, Math.min(want, line.qty, room));
      if (n > 0) {
        out[moveKey(dir, line.good)] = n;
        room -= n;
      }
    }
  }
  return out;
}

// ───────────────────────────── 询价与成交 ─────────────────────────────

/**
 * 现金最多买得起几件（不超过 hi）：逐次询价二分查找（询价与内核同一套计算，含成交量对价格的冲击）。
 * over 是 hi 件的询价（已知超出现金）；先按比例猜一个件数，再二分，至多询价 10 次。买不起一件时返回 null。
 */
export async function affordable(loc: number, good: number, hi: number, cash: number, over: TradeQuote): Promise<{ qty: number; quote: TradeQuote } | null> {
  let lo = 0;
  let loQuote: TradeQuote | null = null;
  let top = hi;
  let guess = over.total > 0 ? Math.floor((hi * cash) / over.total) : 0;
  for (let i = 0; i < 10 && top - lo > 1; i++) {
    const mid = guess > lo && guess < top ? guess : Math.floor((lo + top) / 2);
    guess = 0;
    const q = await api.quote(loc, good, "buy", mid);
    if (q.total <= cash) {
      lo = mid;
      loQuote = q;
    } else {
      top = mid;
    }
  }
  return loQuote && lo > 0 ? { qty: lo, quote: loQuote } : null;
}

/**
 * 询价后成交：先重新询价（买入时合计超出现金就逐次询价找出买得起的最多件数），再以放宽 3% 的限价提交。
 * 返回成交的件数与询价的合计；被拒绝或买不起时返回 null（错误已由 store 显示）。
 */
export async function tradeNow(loc: number, holder: Holder, side: Side, good: number, qty: number): Promise<{ qty: number; total: number } | null> {
  const g = useGame.getState();
  let n = qty;
  let q: TradeQuote;
  try {
    q = await api.quote(loc, good, side, n);
    const cash = useGame.getState().overview?.cash ?? 0;
    if (side === "buy" && q.total > cash) {
      const fit = await affordable(loc, good, n, cash, q);
      if (!fit) {
        g.fail(t("mk.noCash"));
        return null;
      }
      n = fit.qty;
      q = fit.quote;
    }
  } catch (e) {
    g.fail(e);
    return null;
  }
  if (n <= 0) {
    g.fail(t("mk.noCash"));
    return null;
  }
  const limit = side === "buy" ? Math.ceil(q.total * (1 + SLIPPAGE)) : Math.floor(q.total * (1 - SLIPPAGE));
  const r = await useGame.getState().submit(tradeCommand(holder, side, good, n, limit));
  return r ? { qty: n, total: q.total } : null;
}

/** 成交单一行的结果：成交了几件、多少钱；没成交时带上原因（内核或询价的报错）。 */
export interface LineResult {
  line: CartLine;
  done: { qty: number; total: number } | null;
  error: string | null;
}

/**
 * 按成交单逐行成交：先卖后买，每一行都照常询价、放宽限价、由内核裁决。某一行没成交不影响后面的行（错误记在那一行上）。
 * onLine 在每一行结束后调用（界面据此闪一下成交的行）。
 */
export async function settle(loc: number, holder: Holder, lines: readonly CartLine[], onLine?: (r: LineResult) => void): Promise<LineResult[]> {
  const out: LineResult[] = [];
  for (const line of cartLines(Object.fromEntries(lines.map((l) => [l.good, l])))) {
    const done = await tradeNow(loc, holder, line.side, line.good, line.qty);
    const r: LineResult = { line, done, error: done ? null : (useGame.getState().error ?? t("mk.failed")) };
    out.push(r);
    onLine?.(r);
  }
  return out;
}
