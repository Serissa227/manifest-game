// 交易所（现货）的交易台：进门先卖、再买（“卖出 / 买入”两页），
// 在此之上做成现代的一体化交易台（docs/DECISIONS.md“交易操作现代化”）：
// - 每行直接调数量（加减按钮可长按连发、Shift ×10，输入框里方向键、滚轮、拖动），不用先点行再去别处找数量；
// - 调了数量的货进“成交单”：窗口底部的账台写出卖出与买入的合计、盈亏、成交后的现金与装载，现金不够时写明差多少，
//   “成交”一次结清多种货物（先卖后买，每一行照常询价、放宽 3% 限价、由内核裁决）；
// - 一键操作照旧：每行“买满 N / 全卖”，卖出页的“全部卖出”；
// - 成交的行闪一下，现金与装载的数字滚动到新值；买不了、卖不了时在行里写明原因；
// - 点行在这一行下面展开明细（数量滑块与快捷数量、精确预估、只成交这一行、走势与预测、别处的价格）；
// - 键盘：↑↓ 选行，←→ 或 +/− 调数量（Shift ×10），回车成交，空格展开；查找与排序对付三十多种货。
// 有此地收购的货时默认打开卖出页，卖完自动回到买入页；玩家点过页签后以玩家的选择为准。
// 货档（T01）：商誉不够的货照样列在买入页（置灰、排在后面），行里写“差多少商誉”与一键“去投资”，页头写明你在这里的商誉与买得到哪一档。
// 开放市场（DECISIONS“开放市场”）：每个港口都收购所有的货（卖出页每一行都能卖），买入页只列这里出售的货（以本地特产为主）；
// 旧后端的行没有 sold 标记，那时列出的货都能买、船上不在清单里的货注明“此地不收”。
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useView } from "../../hooks/useView";
import { decimal, listJoin, money, num, pct, t, tk } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import { api } from "../../ipc/api";
import { locById } from "../../ipc/byId";
import type { PortView } from "../../ipc/types";
import { useGame, useOverviewFields } from "../../store/game";
import { ActionButton, TabBar } from "../common";
import { EmptyState } from "../feedback";
import { closeWindow } from "../shell/shellState";
import CartBar from "./CartBar";
import MarketDrawer from "./MarketDrawer";
import { BuyRow, ListHead, SellRow } from "./MarketRows";
import { purseState, seenLabel } from "./marketInfo";
import { takeMarketSide, useMarketUi } from "./marketUi";
import { useFlash, useQuotes, useStickyInsets } from "./tradeHooks";
import {
  affordable,
  buyBlock,
  buyCostEstimate,
  buyRoom,
  cartLines,
  curveFrom,
  EMPTY_CART,
  goodMatches,
  holderOptions,
  isSold,
  lineQty,
  loadOf,
  maxBuyImpact,
  normalize,
  quoteKey,
  rankKey,
  saleRows,
  sellBlock,
  settle,
  sortBuyRows,
  summarize,
  tradeNow,
  unitEstimate,
  withLine,
  type BuySort,
  type Cart,
  type CartLine,
  type Load,
  type SellSort,
  type Side,
} from "./trade";

/** 行情通报（随船传递、在这个港口时）：告示板上比手上新的港口与价格，一键买下。 */
function ReportBox({ port }: { port: PortView }) {
  const statics = useGame((s) => s.statics);
  const submit = useGame((s) => s.submit);
  const r = port.report;
  if (!statics || !r) return null;
  if (r.locs.length === 0) {
    return (
      <p className="hint mk-report" data-testid="market-report">
        {t("info.report.none")}
      </p>
    );
  }
  const ports = listJoin(r.locs.map((l) => locById(statics, l)?.name ?? String(l)));
  return (
    <div className="mk-report" data-testid="market-report">
      <p className="hint">
        <strong>{t("info.report.title")}</strong> {t("info.report.offer", { n: r.locs.length, ports, price: money(r.price) })}
      </p>
      <ActionButton onClick={() => submit({ BuyMarketReport: { owner: "player", loc: port.loc } })}>{t("info.report.buy")}</ActionButton>
    </div>
  );
}

/** 城镇钱袋与所属势力的国库（货币流通，ECONOMY.md 6.9）：当地的报价乘流动性系数；钱袋见底时腹地垫付的缺口。 */
function PurseBox({ port }: { port: PortView }) {
  const p = port.purse;
  if (!p) return null;
  const state = purseState(p.liquidity_bp);
  const times = (bp: number) => decimal(bp / 10_000);
  return (
    <div className={`mk-purse mk-purse-${state}`} data-testid="market-purse" title={t("money.hint")}>
      <p className="hint">
        <strong>{t("money.purse")}</strong> {t("money.purseLine", { money: money(p.money), reference: money(p.reference) })} ·{" "}
        {t("money.liquidity", { mult: times(p.liquidity_bp) })} — {tk(`money.${state}`)}
        {p.gaps > 0 && ` ${t("money.gaps", { gaps: money(p.gaps) })}`}
      </p>
      {p.treasury && (
        <p className="hint" data-testid="market-treasury">
          <strong>{t("money.treasury", { faction: p.treasury.faction })}</strong>{" "}
          {t("money.treasuryLine", {
            money: money(p.treasury.money),
            tax: times(p.treasury.tax_mult_bp),
            patrol: `${pct(p.treasury.patrol_bp, 0)}%`,
          })}
        </p>
      )}
    </div>
  );
}

const EMPTY_LOAD: Load = { cargo: [], used: 0, capacity: 0 };
/** 长列表才给查找与排序（卖出页通常只有几种货）。 */
const TOOLS_FROM = 8;

/** 交易所。 */
export default function Market({ port }: { port: PortView }) {
  const statics = useGame((s) => s.statics);
  // 按字段选取（P14a）：只取用到的顶层字段，没变就不重渲染
  const overview = useOverviewFields("fleets", "caravans", "cash");
  const holders = useMemo(() => holderOptions(port), [port]);
  const [holderKey, setHolderKey] = useState<string>("");
  const [chosenSide, setChosenSide] = useState<Side | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  // 成交单按持有者分开存（切换舰队 / 商队 / 仓库时各自的成交单都还在）
  const [carts, setCarts] = useState<Record<string, Cart>>({});
  // 上次成交没成交的行：原因写在那一行上（改了数量就清掉），键为“持有者:商品”
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [buySort, setBuySort] = useState<BuySort>("default");
  const [sellSort, setSellSort] = useState<SellSort>("default");
  const [active, setActive] = useState<number | null>(null);
  const [flash, fireFlash] = useFlash();
  const stickyRef = useStickyInsets();
  const rowEls = useRef(new Map<number, HTMLDivElement>());
  // 外面（新手教程）请交易所切到某一页：开着时马上切，没开着的在打开时切；只照办一次
  const sideAsk = useMarketUi((s) => s.nonce);
  useEffect(() => {
    const s = takeMarketSide();
    if (s) {
      setChosenSide(s);
      setExpanded(null);
    }
  }, [sideAsk]);
  const holder = holders.find((h) => h.value === holderKey) ?? holders[0];
  const live = !!holder && !port.seen;

  const rows = useMemo(() => new Map(port.market.map((r) => [r.good, r])), [port.market]);
  // 买入页：这里出售的货（开放市场以本地特产为主；旧后端是全部）
  const sale = useMemo(() => saleRows(port), [port]);
  const load: Load = holder ? loadOf(overview, port, holder.holder) : EMPTY_LOAD;
  const goods = statics?.goods ?? [];
  const rawCart = holder ? (carts[holder.value] ?? EMPTY_CART) : EMPTY_CART;
  const cart = live ? normalize(rawCart, load, rows, port, goods) : EMPTY_CART;
  const lines = cartLines(cart);
  const quotes = useQuotes(port.loc, lines, live);
  // 价格曲线（全局规则，取这个港口第一种货的行情序列）：估算“买满”的件数时算上成交量对价格的冲击；取不到就按现价估算
  const firstGood = port.market[0]?.good;
  const { data: curveSeries } = useView(
    live && firstGood !== undefined ? `mkcurve:${port.loc}` : null,
    () => api.marketSeries(port.loc, firstGood ?? 0).catch(() => null),
    false,
  );
  const curve = curveFrom(curveSeries);

  if (!statics) return null;
  // 还没到过的港口：新界面另说一句怎么才看得到，“下一步”打开航海图（定航线过去）；旧界面照旧一行字
  if (!port.known)
    return (
      <EmptyState
        text={t("exUnknown")}
        hint={t("v2.port.mk.unknownHint")}
        action={{
          label: t("v2.port.toChart"),
          onClick: () => {
            useGame.getState().setStage("chart");
            closeWindow();
          },
        }}
      />
    );

  const cash = overview?.cash ?? 0;
  const free = Math.max(0, load.capacity - load.used);
  const cargo = load.cargo.filter((c) => c.qty > 0);
  // 此地收购的在前，不收的排在后面
  const sellLines = [...cargo].sort((a, b) => Number(rows.has(b.good)) - Number(rows.has(a.good)));
  const sellable = sellLines.filter((c) => !sellBlock(port, rows.get(c.good), goods[c.good]));
  const side: Side = chosenSide ?? (sellable.length > 0 && !port.seen ? "sell" : "buy");
  const goodName = (g: number) => goods[g]?.name ?? String(g);
  const estimateSell = (good: number, qty: number) => {
    const r = rows.get(good);
    return r ? unitEstimate(port, r, "sell") * qty : 0;
  };
  const sellAllTotal = sellable.reduce((a, c) => a + estimateSell(c.good, c.qty), 0);
  const noteKey = (g: number) => `${holder?.value ?? ""}:${g}`;
  // 货档（T01）：这里设得了商馆时（港口；内陆城市的最高等级是 0），锁着的行与页头都给一键“去投资”
  const house = port.invest.house ?? null;
  const canInvest = !!house && house.max_level > 0;
  const goInvest = canInvest ? () => useGame.getState().setFacility("invest") : undefined;
  const lockedCount = sale.filter((r) => (r.rank_short ?? 0) > 0).length;
  const goodwillHere = house?.goodwill ?? port.office.reputation;
  const topRank = house?.top_rank ?? 0;

  // ── 成交单 ──
  const quoteOf = (l: CartLine) => {
    const q = quotes[quoteKey(l)];
    return q && q.qty === l.qty ? q : undefined;
  };
  const estimateOf = (l: CartLine) => {
    const r = rows.get(l.good);
    if (!r) return 0;
    return l.side === "buy" && curve ? buyCostEstimate(port, r, l.qty, curve) : unitEstimate(port, r, l.side) * l.qty;
  };
  const fullOf = (r: (typeof port.market)[number]) => maxBuyImpact(port, r, cash, free, curve);
  const summary = lines.length > 0 ? summarize(lines, quoteOf, estimateOf, cash, load) : null;
  const staged = (good: number, s: Side) => lineQty(cart, good, s);
  const lineTotal = (l: CartLine) => quoteOf(l)?.total ?? Math.round(estimateOf(l));
  /** 买某种货时还能花多少：现金 + 成交单里卖出的所得 − 其他要买的花费。 */
  const cashLeftFor = (good: number) =>
    lines.reduce((a, l) => (l.side === "sell" ? a + lineTotal(l) : l.good === good ? a : a - lineTotal(l)), cash);
  /**
   * 这一行数量的上限：卖出是持有的件数；买入按舱位与库存（成交单里卖出腾出的空位算进去），并按剩下的现金估算买得起几件
   * （算上成交量对价格的冲击）。已经调了的数量不会被压下去（现金后来变少时由账台写明差多少）。
   */
  const maxFor = (good: number, s: Side) => {
    if (!live) return 0;
    const r = rows.get(good);
    if (s === "sell") return sellBlock(port, r, goods[good]) ? 0 : (load.cargo.find((c) => c.good === good)?.qty ?? 0);
    if (!r || !isSold(r) || buyBlock(port, r, goods[good])) return 0;
    const afford = maxBuyImpact(port, r, cashLeftFor(good), buyRoom(load, cart, good, r.stock), curve).qty;
    return Math.max(staged(good, "buy"), afford);
  };
  const updateCart = (fn: (c: Cart) => Cart) => {
    if (!holder) return;
    const key = holder.value;
    // 以整理过的成交单为底：刚卖掉的货、装不下的件数不会在成交单里留着
    setCarts((all) => ({ ...all, [key]: fn(live ? normalize(all[key] ?? EMPTY_CART, load, rows, port, goods) : EMPTY_CART) }));
  };
  const setQty = (good: number, s: Side, qty: number) => {
    const n = Math.max(0, Math.min(maxFor(good, s), Math.floor(qty)));
    updateCart((c) => withLine(c, good, s, n));
    const k = noteKey(good);
    if (notes[k]) {
      setNotes((all) => {
        const next = { ...all };
        delete next[k];
        return next;
      });
    }
  };
  const dropLines = (goods: readonly number[]) =>
    updateCart((c) => {
      let n = c;
      for (const g of goods) {
        const l = n[g];
        if (l) n = withLine(n, g, l.side, 0);
      }
      return n;
    });

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  // ── 一键操作：买满 / 全卖 / 全部卖出（立即成交） ──
  const doTrade = (s: Side, good: number, qty: number) =>
    run(async () => {
      if (!holder) return;
      const line = cargo.find((c) => c.good === good);
      const done = await tradeNow(port.loc, holder.holder, s, good, qty);
      if (!done) return;
      fireFlash([good]);
      dropLines([good]);
      if (s === "sell") {
        const profit = done.total - (line?.avg_cost ?? 0) * done.qty;
        useGame.getState().notify(t("mk.sold", { good: goodName(good), qty: num(done.qty), total: money(done.total), profit: `${profit >= 0 ? "+" : ""}${num(profit)}` }));
      } else {
        useGame.getState().notify(t("mk.bought", { good: goodName(good), qty: num(done.qty), total: money(done.total) }));
      }
    });

  const sellAll = () =>
    run(async () => {
      if (!holder) return;
      let total = 0;
      let kinds = 0;
      const sold: number[] = [];
      for (const c of sellable) {
        const done = await tradeNow(port.loc, holder.holder, "sell", c.good, c.qty);
        if (!done) break;
        total += done.total;
        kinds += 1;
        sold.push(c.good);
        fireFlash([c.good]);
      }
      dropLines(sold);
      if (kinds > 0) useGame.getState().notify(t("mk.soldAll", { n: kinds, total: money(total) }));
    });

  // ── 成交单：一次结清 ──
  const settleCart = () =>
    run(async () => {
      if (!holder || lines.length === 0) return;
      const key = holder.value;
      const costs = new Map(load.cargo.map((c) => [c.good, c.avg_cost]));
      const results = await settle(port.loc, holder.holder, lines, (r) => {
        if (r.done) fireFlash([r.line.good]);
      });
      const done = results.filter((r) => r.done);
      const failed = results.filter((r) => !r.done);
      setCarts((all) => {
        let c = all[key] ?? EMPTY_CART;
        for (const r of done) c = withLine(c, r.line.good, r.line.side, 0);
        return { ...all, [key]: c };
      });
      setNotes((n) => ({ ...n, ...Object.fromEntries(failed.map((r) => [`${key}:${r.line.good}`, r.error ?? t("mk.failed")])) }));
      if (done.length === 0) return;
      const sold = done.filter((r) => r.line.side === "sell");
      const bought = done.filter((r) => r.line.side === "buy");
      const parts: string[] = [];
      if (sold.length > 0) {
        const total = sold.reduce((a, r) => a + (r.done?.total ?? 0), 0);
        const profit = sold.reduce((a, r) => a + (r.done?.total ?? 0) - (costs.get(r.line.good) ?? 0) * (r.done?.qty ?? 0), 0);
        parts.push(t("mk.partSell", { n: sold.length, total: money(total), profit: `${profit >= 0 ? "+" : ""}${num(Math.round(profit))}` }));
      }
      if (bought.length > 0) parts.push(t("mk.partBuy", { n: bought.length, total: money(bought.reduce((a, r) => a + (r.done?.total ?? 0), 0)) }));
      for (const r of bought) if (r.done && r.done.qty < r.line.qty) parts.push(t("mk.partial", { good: goodName(r.line.good), qty: num(r.done.qty) }));
      if (failed.length > 0) parts.push(t("mk.notDone", { n: failed.length }));
      useGame.getState().notify(t("mk.settled", { n: done.length, parts: parts.join(t("mk.partSep")) }));
    });

  /** 现金不够：从最后一行买入往前减，按询价找出买得起的件数，直到够为止。 */
  const fitCash = () =>
    run(async () => {
      if (!summary || summary.shortCash <= 0) return;
      let over = summary.shortCash;
      let c: Cart = cart;
      try {
        for (const l of [...lines].reverse()) {
          if (over <= 0) break;
          if (l.side !== "buy") continue;
          const q = quoteOf(l) ?? (await api.quote(port.loc, l.good, "buy", l.qty));
          const allowed = q.total - over;
          const fit = allowed > 0 ? await affordable(port.loc, l.good, l.qty, allowed, q) : null;
          c = withLine(c, l.good, "buy", fit?.qty ?? 0);
          over -= q.total - (fit?.quote.total ?? 0);
        }
      } catch (e) {
        useGame.getState().fail(e);
      }
      updateCart(() => c);
    });

  // ── 查找、排序与键盘 ──
  const q = query.trim();
  const buyRows = sortBuyRows(
    sale.filter((r) => goodMatches(goods[r.good], q)),
    buySort,
  );
  const shownSell = sellLines.filter((c) => goodMatches(goods[c.good], q));
  if (sellSort !== "default") {
    const val = (c: (typeof shownSell)[number]) =>
      rows.has(c.good) ? (sellSort === "bid" ? unitEstimate(port, rows.get(c.good)!, "sell") : estimateSell(c.good, c.qty) - c.avg_cost * c.qty) : -Infinity;
    shownSell.sort((a, b) => val(b) - val(a));
  }
  const order = side === "sell" ? shownSell.map((c) => c.good) : buyRows.map((r) => r.good);
  const activeGood = active !== null && order.includes(active) ? active : (order[0] ?? null);

  const focusRow = (good: number | undefined) => {
    if (good === undefined) return;
    setActive(good);
    rowEls.current.get(good)?.focus();
  };
  const toggle = (good: number) => {
    setActive(good);
    setExpanded((e) => (e === good ? null : good));
  };
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const rowEl = target.closest<HTMLElement>("[data-good]");
    if (!rowEl) return;
    const good = Number(rowEl.dataset.good);
    const i = order.indexOf(good);
    const inField = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
    const onRow = target === rowEl;
    // Shift ×10 只给方向键：多数键盘上“+”本身就要按 Shift
    const big = e.shiftKey && (e.key === "ArrowRight" || e.key === "ArrowLeft") ? 10 : 1;
    const bump = (d: number) => setQty(good, side, staged(good, side) + d);
    let handled = true;
    switch (e.key) {
      case "ArrowDown":
        if (inField) return;
        focusRow(order[Math.min(order.length - 1, i + 1)]);
        break;
      case "ArrowUp":
        if (inField) return;
        focusRow(order[Math.max(0, i - 1)]);
        break;
      case "PageDown":
        if (!onRow) return;
        focusRow(order[Math.min(order.length - 1, i + 8)]);
        break;
      case "PageUp":
        if (!onRow) return;
        focusRow(order[Math.max(0, i - 8)]);
        break;
      case "Home":
        if (!onRow) return;
        focusRow(order[0]);
        break;
      case "End":
        if (!onRow) return;
        focusRow(order[order.length - 1]);
        break;
      case "ArrowRight":
      case "+":
      case "=":
        if (inField) return;
        bump(big);
        break;
      case "ArrowLeft":
      case "-":
      case "_":
        if (inField) return;
        bump(-big);
        break;
      case "Backspace":
      case "Delete":
        if (!onRow) return;
        setQty(good, side, 0);
        break;
      case " ":
        if (!onRow) return;
        toggle(good);
        break;
      case "Enter":
        // 回车成交；成交单是空的时，在行上回车展开明细
        if (!inField && !onRow) return;
        if (lines.length > 0) {
          if (summary && summary.shortCash <= 0 && summary.overSpace <= 0) void settleCart();
        } else if (onRow) toggle(good);
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  };
  const rowRef = (good: number) => (el: HTMLDivElement | null) => {
    if (el) rowEls.current.set(good, el);
    else rowEls.current.delete(good);
  };

  const drawerFor = (good: number) => {
    const r = rows.get(good);
    const line = cargo.find((c) => c.good === good);
    const g = goods[good];
    const max = maxFor(good, side);
    const block = side === "sell" ? sellBlock(port, r, g) : r ? buyBlock(port, r, g) : null;
    const full = side === "buy" && r && live ? fullOf(r) : null;
    const why = port.seen
      ? t("mk.remote")
      : block === "rank"
        ? tz(goInvest ? "mk.rank.hint" : "mk.rank.hintCity", { need: r?.rank_need ?? 0, have: (r?.rank_need ?? 0) - (r?.rank_short ?? 0) })
        : block === "reserved"
          ? tz("mk.reserved.hint")
          : block
            ? t(`mk.blockHint.${block}`)
            : side === "sell"
              ? t("mk.nothingToSell")
              : full && full.qty <= 0
                ? tk(`mk.limit.${full.limit}`)
                : t("mk.cannotBuy");
    const l = cart[good];
    return (
      <MarketDrawer
        key={`${side}-${good}-${holder?.value ?? ""}`}
        port={port}
        row={r}
        good={good}
        goodView={g}
        side={side}
        hasHolder={!!holder}
        canTrade={live && !!r && !block && max > 0}
        why={why}
        held={line?.qty ?? 0}
        avgCost={line?.avg_cost ?? 0}
        max={max}
        qty={staged(good, side)}
        quote={l && l.side === side ? quoteOf(l) : undefined}
        busy={busy}
        setQty={(n) => setQty(good, side, n)}
        onTrade={(n) => void doTrade(side, good, n)}
      />
    );
  };

  const tools = (count: number) =>
    count >= TOOLS_FROM || q !== "" ? (
      <div className="mk-tools">
        <input
          type="search"
          className="mk-search"
          value={query}
          placeholder={t("mk.search")}
          aria-label={t("mk.search")}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="mk-sort">
          <span>{t("mk.sort")}</span>
          {side === "buy" ? (
            <select value={buySort} aria-label={t("mk.sort")} onChange={(e) => setBuySort(e.target.value as BuySort)}>
              {(["default", "cheap", "price", "stock"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`mk.sort.${k}`)}
                </option>
              ))}
            </select>
          ) : (
            <select value={sellSort} aria-label={t("mk.sort")} onChange={(e) => setSellSort(e.target.value as SellSort)}>
              {(["default", "profit", "bid"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`mk.sort.${k}`)}
                </option>
              ))}
            </select>
          )}
        </label>
      </div>
    ) : null;

  const noMatch = (
    <p className="hint mk-empty" data-testid="mk-no-match">
      {t("mk.noMatch", { q })}
    </p>
  );

  return (
    <div className="market" data-testid="market" ref={stickyRef}>
      {port.bargain && <p className="hint">{t("mkBargain", { pct: pct(port.bargain[0]), until: port.bargain[1] })}</p>}
      {port.seen && (
        <p className="hint mk-seen" role="note" data-testid="market-seen">
          <strong>{seenLabel(port.seen)}</strong>
          {t("info.staleNote")}
        </p>
      )}
      <ReportBox port={port} />
      <PurseBox port={port} />

      <div className="mk-summary" data-testid="mk-summary">
        {holders.length > 1 ? (
          <div className="mk-holders" role="group" aria-label={t("mkHolder")}>
            {holders.map((h) => {
              const n = cartLines(carts[h.value] ?? EMPTY_CART).length;
              return (
                <button
                  key={h.value}
                  type="button"
                  className={h === holder ? "btn small active" : "btn small"}
                  aria-pressed={h === holder}
                  onClick={() => {
                    setHolderKey(h.value);
                    setExpanded(null);
                  }}
                >
                  {h.label}
                  {n > 0 && <span className="mk-holder-count">{t("mk.holderCart", { n })}</span>}
                </button>
              );
            })}
          </div>
        ) : holder ? (
          <strong className="mk-holder">{holder.label}</strong>
        ) : (
          <span className="mk-holder">{t("mkNoHolder")}</span>
        )}
      </div>

      <TabBar<Side>
        label={t("mk.tabs")}
        active={side}
        onSelect={(s) => {
          setChosenSide(s);
          setExpanded(null);
        }}
        items={[
          { key: "sell", label: t("mk.tabSell", { n: sellLines.length }) },
          { key: "buy", label: t("mk.tabBuy", { n: sale.length }) },
        ]}
      />

      {side === "sell" ? (
        <div role="tabpanel" data-testid="mk-sell">
          {sellLines.length === 0 ? (
            <p className="hint mk-empty" data-testid="mk-sell-empty">
              {holder ? t("mk.emptyHold", { holder: holder.label }) : t("mkNoHolder")}
            </p>
          ) : (
            <>
              <div className="mk-toolbar">
                <span className="sub">{sellable.length > 0 ? t("mk.sellHint", { total: money(Math.round(sellAllTotal)) }) : t("mk.noneBoughtHere")}</span>
                <button type="button" className="btn primary" disabled={busy || !live || sellable.length === 0} onClick={() => void sellAll()} data-testid="mk-sell-all">
                  {t("mk.sellEverything")}
                </button>
              </div>
              {tools(sellLines.length)}
              <div role="table" className="mk-list mk-list-sell" aria-label={t("mkSell")} onKeyDown={onListKey}>
                <ListHead
                  cells={[
                    { label: t("mkGood") },
                    { label: t("mk.bid") },
                    { label: t("mk.profit") },
                    { label: t("mkQty") },
                    { label: t("mk.action"), quiet: true },
                  ]}
                />
                <div role="rowgroup">
                  {shownSell.map((c) => {
                    const r = rows.get(c.good);
                    const l = cart[c.good];
                    return (
                      <Fragment key={c.good}>
                      <SellRow
                        port={port}
                        line={c}
                        row={r}
                        good={goods[c.good]}
                        live={live}
                        busy={busy}
                        staged={staged(c.good, "sell")}
                        quote={l && l.side === "sell" ? quoteOf(l) : undefined}
                        block={sellBlock(port, r, goods[c.good])}
                        open={expanded === c.good}
                        active={activeGood === c.good}
                        flash={flash[c.good]}
                        note={notes[noteKey(c.good)]}
                        setQty={(n) => setQty(c.good, "sell", n)}
                        onSellAll={() => void doTrade("sell", c.good, c.qty)}
                        onToggle={() => toggle(c.good)}
                        onFocusRow={() => setActive(c.good)}
                        rowRef={rowRef(c.good)}
                      />
                      {expanded === c.good && drawerFor(c.good)}
                      </Fragment>
                    );
                  })}
                </div>
              </div>
              {shownSell.length === 0 && noMatch}
            </>
          )}
        </div>
      ) : (
        <div role="tabpanel" data-testid="mk-buy">
          {sale.length < port.market.length && (
            <p className="hint mk-sale-hint" data-testid="mk-sale-hint">
              {t("mk.saleHint", { n: sale.length })}
            </p>
          )}
          {house?.grace_left != null && (
            <p className="hint mk-rank-bar" data-testid="mk-rank-grace">
              {tz("mk.rank.grace", { n: house.grace_left })}
            </p>
          )}
          {lockedCount > 0 && (
            <div className="hint mk-rank-bar" role="note" data-testid="mk-rank-bar">
              <span>
                {house && canInvest
                  ? tz("mk.rank.bar", {
                      goodwill: goodwillHere,
                      rep: house.reputation,
                      house: house.goodwill - house.reputation,
                      top: tz(rankKey(topRank)),
                      n: lockedCount,
                    })
                  : tz("mk.rank.barCity", { goodwill: goodwillHere, top: tz(rankKey(topRank)), n: lockedCount })}
              </span>
              {goInvest && (
                <button type="button" className="btn small mk-rank-go" title={tz("mk.rank.goHint")} onClick={goInvest}>
                  {tz("mk.rank.go")}
                </button>
              )}
            </div>
          )}
          {tools(sale.length)}
          <div role="table" className={live ? "mk-list mk-list-buy" : "mk-list mk-list-buy mk-list-ro"} aria-label={t("mkBuy")} onKeyDown={onListKey}>
            <ListHead
              cells={[
                { label: t("mkGood") },
                { label: t("mkPrice") },
                { label: t("mkStock") },
                ...(live ? [{ label: t("mkQty") }, { label: t("mk.action"), quiet: true }] : []),
              ]}
            />
            <div role="rowgroup">
              {buyRows.map((r) => {
                const g = goods[r.good];
                const l = cart[r.good];
                const full = live ? fullOf(r) : null;
                return (
                  <Fragment key={r.good}>
                  <BuyRow
                    port={port}
                    row={r}
                    good={g}
                    live={live}
                    busy={busy}
                    held={cargo.find((c) => c.good === r.good)}
                    staged={staged(r.good, "buy")}
                    max={maxFor(r.good, "buy")}
                    quote={l && l.side === "buy" ? quoteOf(l) : undefined}
                    estimate={l && l.side === "buy" ? estimateOf(l) : 0}
                    full={full}
                    fullCost={full && full.qty > 0 ? estimateOf({ good: r.good, side: "buy", qty: full.qty }) : 0}
                    block={buyBlock(port, r, g)}
                    onInvest={goInvest}
                    open={expanded === r.good}
                    active={activeGood === r.good}
                    flash={flash[r.good]}
                    note={notes[noteKey(r.good)]}
                    setQty={(n) => setQty(r.good, "buy", n)}
                    onBuyMax={() => {
                      if (full && full.qty > 0) void doTrade("buy", r.good, full.qty);
                    }}
                    onToggle={() => toggle(r.good)}
                    onFocusRow={() => setActive(r.good)}
                    rowRef={rowRef(r.good)}
                  />
                  {expanded === r.good && drawerFor(r.good)}
                  </Fragment>
                );
              })}
            </div>
          </div>
          {buyRows.length === 0 && q !== "" && noMatch}
        </div>
      )}

      {live && (
        <CartBar
          cash={cash}
          load={load}
          summary={summary}
          lines={lines.length}
          busy={busy}
          onSettle={() => void settleCart()}
          onClear={() => updateCart(() => EMPTY_CART)}
          onFitCash={() => void fitCash()}
        />
      )}
    </div>
  );
}
