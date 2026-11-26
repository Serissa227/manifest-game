// 交易所的行（界面总体见 Market.tsx）：每行直接调数量（QtyStepper），右边是一键操作（买满 / 全卖）；
// 买不了、卖不了时在同一处写明原因（禁运、许可证、此地不收，件数上的现金 / 舱位 / 库存写在“买满”按钮上）。
// 货档（T01）：商誉不够的货照样列出、置灰，同一处写“差多少商誉”，旁边一键“去投资”（内陆城市设不了商馆，只写原因）。
// 行里的参照信息：现价与昨天比的涨跌、近来的走势小图、比常价贵还是便宜（T04 后端给常价时；旧后端比基准价）、库存（远方港口只给档位）、自己持有的件数与成本。
// FE1：托运中的货（T04b reserved）买入一格明写“本港正托人运这种货，暂时不卖”，买的按钮不出；熟客放行（rank_pass = patron）标“熟客照卖”。
// 宽的窗口一行一种货（与表头对齐），窄的窗口（手机）折成两三行的卡片：布局都在 styles/trade.css，靠容器查询切换。
import { memo, type ReactNode } from "react";
import { money, num, otherName, t, tk } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import type { CargoLine, GoodView, MarketRow, PortView, TradeQuote } from "../../ipc/types";
import { GoodGlyph } from "./GoodGlyph";
import { bpPct, dayMove, stockBand, trendPct, vsBase } from "./marketInfo";
import { QtyStepper, Sparkline } from "./tradeKit";
import { rankKey, unitEstimate, type BuyBlock, type SellBlock } from "./trade";

/** 商品图标（对辅助技术隐藏）：新界面里是手绘图，经典像素界面里是 16×16 的像素图样。 */
export const GoodIcon = memo(function GoodIcon({ good, scale = 1 }: { good: GoodView | undefined; scale?: number }) {
  return <GoodGlyph goodKey={good?.key} category={good?.category} scale={scale} className="good-icon" />;
});

/** 带正负号的整数（盈亏）：正数绿、负数红。 */
export function Profit({ value, testId }: { value: number; testId?: string }) {
  const v = Math.round(value);
  return (
    <span className={v > 0 ? "mk-gain" : v < 0 ? "mk-loss" : "mk-even"} data-testid={testId}>
      {v > 0 ? "+" : ""}
      {num(v)}
    </span>
  );
}

/** 商品名与标签（特产、流行、许可证、禁运、出口税、进口关税）；sub 是名字下面的一小行（持有与成本）。 */
function GoodName({ good, id, row, sub }: { good: GoodView | undefined; id: number; row: MarketRow | undefined; sub?: ReactNode }) {
  return (
    <div role="cell" className="mk-c-good" title={otherName(good)}>
      <span className="mk-name">
        <GoodIcon good={good} />
        <span className="mk-name-text">{good?.name ?? String(id)}</span>
        {row?.specialty && <em className="tag">{t("mkSpecialty")}</em>}
        {row?.popular && <em className="tag hot">{t("mkPopular")}</em>}
        {good?.license && <em className="tag">{t("mkLicense")}</em>}
        {(good?.rank ?? 0) > 0 && (
          <em
            className={(row?.rank_short ?? 0) > 0 ? "tag mk-rank locked" : "tag mk-rank"}
            data-testid={`mk-rank-${id}`}
            title={
              (row?.rank_need ?? 0) > 0
                ? tz("mk.rank.tagHint", { name: tz(rankKey(good?.rank ?? 0)), need: row?.rank_need ?? 0 })
                : tz("mk.rank.tagOpen", { name: tz(rankKey(good?.rank ?? 0)) })
            }
          >
            {tz(rankKey(good?.rank ?? 0))}
          </em>
        )}
        {row?.rank_pass === "errand" && <em className="tag mk-rank-pass">{tz("mk.rank.errand")}</em>}
        {row?.rank_pass === "patron" && (
          <em className="tag mk-rank-pass" title={tz("mk.rank.patronHint")} data-testid={`mk-patron-${id}`}>
            {tz("mk.rank.patron")}
          </em>
        )}
        {row?.reserved && (
          <em className="tag hot mk-reserved" title={tz("mk.reserved.hint")} data-testid={`mk-reserved-tag-${id}`}>
            {tz("mk.reserved.tag")}
          </em>
        )}
        {row?.banned && (
          <em className="tag hot mk-policy" title={t("pol.banHint")}>
            {t("pol.ban")}
          </em>
        )}
        {row?.export_tax_bp && (
          <em className="tag mk-policy" title={t("pol.exportHint")}>
            {t("pol.export", { x: row.export_tax_bp / 10000 })}
          </em>
        )}
        {row?.import_tax_bp && (
          <em className="tag mk-policy" title={t("pol.importHint")}>
            {t("pol.import", { x: row.import_tax_bp / 10000 })}
          </em>
        )}
      </span>
      {sub && <span className="mk-sub">{sub}</span>}
    </div>
  );
}

/**
 * 价格：数字 + 与昨天比的涨跌 + 近来的走势小图 + 比常价（T04：这座港口供需平衡时的价钱；旧后端没有常价时比基准价）。
 * 高于常价为暖红（卖的好时机），低于为绿（买的好时机）。悬停写常价、基准价各是多少，现价是它们的几成。
 */
function PriceBlock({ row, value, area, hint }: { row: MarketRow; value?: number; area: string; hint?: string }) {
  const shown = value ?? row.price;
  const hasNormal = typeof row.vs_normal_bp === "number" && typeof row.normal === "number" && row.normal > 0;
  const rel = hasNormal ? bpPct(row.vs_normal_bp ?? 10_000) : vsBase(row.price, row.base_price);
  const move = dayMove(row.history, row.price, row.base_price);
  const trend = trendPct(row.history);
  const trendTip = t("mk.trendHint", { days: row.history.length, sign: trend > 0 ? "+" : "", pct: trend, base: num(row.base_price) });
  const normalTip = hasNormal
    ? tz("mk.vsNormalHint", {
        normal: num(row.normal ?? 0),
        n: Math.round((row.vs_normal_bp ?? 10_000) / 100),
        base: num(row.base_price),
        b: Math.round((row.vs_base_bp ?? 10_000) / 100),
      })
    : null;
  const tip = [hint, normalTip, trendTip].filter(Boolean).join("\n");
  return (
    <div role="cell" className={`mk-c-${area} mk-price ${rel > 0 ? "up" : rel < 0 ? "down" : ""}`.trim()} title={tip}>
      <span className="mk-price-line">
        <span className="mk-price-n">{num(Math.round(shown))}</span>
        {move !== 0 && (
          <span className={move > 0 ? "mk-arrow rise" : "mk-arrow fall"} aria-hidden="true">
            {move > 0 ? "▲" : "▼"}
          </span>
        )}
        <Sparkline data={row.history} />
      </span>
      {rel !== 0 && (
        <small className="mk-vs" aria-hidden="true" data-testid={`mk-vs-${row.good}`}>
          {hasNormal ? tz("mk.vsNormal", { sign: rel > 0 ? "+" : "", pct: rel }) : t("portMarketVsBase", { sign: rel > 0 ? "+" : "", pct: rel })}
        </small>
      )}
    </div>
  );
}

/** 表头（宽窗口里显示；窄窗口里只给读屏）。quiet 的一格只给读屏（例如“操作”一列）。 */
export function ListHead({ cells }: { cells: { label: string; quiet?: boolean }[] }) {
  return (
    <div role="row" className="mk-head">
      {cells.map((c, i) => (
        <div role="columnheader" key={i} className={`mk-h mk-h-${i}`}>
          {c.quiet ? <span className="mk-sr">{c.label}</span> : c.label}
        </div>
      ))}
    </div>
  );
}

/** 行的公共部分：键盘焦点（同一时刻只有一行在 Tab 顺序里）、点行展开明细（点在按钮、输入框上不算）、成交后闪一下。 */
interface RowShell {
  good: number;
  testId: string;
  open: boolean;
  active: boolean;
  staged: number;
  flash?: number;
  extra?: string;
  onToggle: () => void;
  onFocusRow: () => void;
  rowRef: (el: HTMLDivElement | null) => void;
  children: ReactNode;
}

function Row({ good, testId, open, active, staged, flash, extra, onToggle, onFocusRow, rowRef, children }: RowShell) {
  const cls = [
    "mk-row",
    extra ?? "",
    open ? "open selected" : "",
    staged > 0 ? "staged" : "",
    flash ? `mk-flash mk-flash-${flash % 2}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      ref={rowRef}
      role="row"
      className={cls}
      data-good={good}
      data-testid={testId}
      tabIndex={active ? 0 : -1}
      aria-expanded={open}
      onFocus={onFocusRow}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button, input, select, a, label")) return;
        onToggle();
      }}
    >
      {children}
    </div>
  );
}

export interface BuyRowProps {
  port: PortView;
  row: MarketRow;
  good: GoodView | undefined;
  /** 此地有自己的持有者、看得到实时行情：可以交易 */
  live: boolean;
  busy: boolean;
  held: CargoLine | undefined;
  staged: number;
  max: number;
  quote: TradeQuote | undefined;
  /** 成交单里这一行的估算合计（还没询到价时显示） */
  estimate: number;
  /** 一键买满的件数与卡在哪里（不能交易时为 null）、约花多少 */
  full: { qty: number; limit: "cash" | "space" | "stock" } | null;
  fullCost: number;
  block: BuyBlock | null;
  /** 货档锁着时“去投资”的去处（这座港口设得了商馆时才有） */
  onInvest?: () => void;
  open: boolean;
  active: boolean;
  flash?: number;
  note?: string;
  setQty: (n: number) => void;
  onBuyMax: () => void;
  onToggle: () => void;
  onFocusRow: () => void;
  rowRef: (el: HTMLDivElement | null) => void;
}

/** 买入页的一行。 */
export function BuyRow(p: BuyRowProps) {
  const { port, row, good, live, busy, held, staged, max, quote, full, block, open } = p;
  const name = good?.name ?? String(row.good);
  const stock = port.seen ? (
    <span className="mk-band" title={t("info.bandHint", { age: port.seen.age })}>
      {tk(`info.band.${stockBand(row.stock, row.target)}`)}
    </span>
  ) : (
    <>
      <span className="mk-stock-n">{row.stock}</span>
      <small className={`mk-stock-band band-${stockBand(row.stock, row.target)}`}>{tk(`info.band.${stockBand(row.stock, row.target)}`)}</small>
      {row.rare?.left != null && (
        <small className="mk-rare-left" data-testid={`market-rare-left-${row.good}`}>
          {tz("mk.rareLeft", { n: num(row.rare.left) })}
        </small>
      )}
    </>
  );
  const sub = held && held.qty > 0 ? t("mk.heldLine", { qty: num(held.qty), cost: num(held.avg_cost) }) : undefined;
  return (
    <Row
      good={row.good}
      testId={`market-row-${row.good}`}
      open={open}
      active={p.active}
      staged={staged}
      flash={p.flash}
      extra={live && block ? "mk-blocked" : !live ? "mk-readonly" : undefined}
      onToggle={p.onToggle}
      onFocusRow={p.onFocusRow}
      rowRef={p.rowRef}
    >
      <GoodName good={good} id={row.good} row={row} sub={sub} />
      <PriceBlock row={row} area="price" />
      <div role="cell" className="mk-c-stock">
        <span className="mk-lbl">{t("mkStock")}</span>
        {stock}
      </div>
      {live && block === "rank" ? (
        <div
          role="cell"
          className="mk-c-why mk-c-rank"
          data-testid={`mk-rank-why-${row.good}`}
          title={tz(p.onInvest ? "mk.rank.hint" : "mk.rank.hintCity", {
            need: row.rank_need ?? 0,
            have: (row.rank_need ?? 0) - (row.rank_short ?? 0),
          })}
        >
          <span>{tz("mk.rank.short", { n: row.rank_short ?? 0 })}</span>
          {p.onInvest && (
            <button type="button" className="btn small mk-rank-go" title={tz("mk.rank.goHint")} onClick={p.onInvest}>
              {tz("mk.rank.go")}
            </button>
          )}
        </div>
      ) : block === "reserved" ? (
        // 托运中：远方行情里也照样写明（在这里也买不到），不出数量块与“买满”
        <div role="cell" className="mk-c-why mk-c-reserved" title={tz("mk.reserved.hint")} data-testid={`mk-reserved-${row.good}`}>
          {tz("mk.reserved.short")}
        </div>
      ) : live && block && block !== "rank" ? (
        <div role="cell" className="mk-c-why" title={t(`mk.blockHint.${block}`)}>
          {t(`mk.block.${block}`)}
        </div>
      ) : live ? (
        <>
          <div role="cell" className="mk-c-qty">
            {!open && (
              <QtyStepper
                value={staged}
                max={max}
                onChange={p.setQty}
                label={t("mk.qtyBuy", { good: name })}
                decLabel={t("mk.decBuy")}
                incLabel={t("mk.incBuy")}
                disabled={busy}
                testId={`mk-step-${row.good}`}
              />
            )}
            {staged > 0 && !open && (
              <small className="mk-line-total" data-testid={`mk-line-${row.good}`}>
                {quote ? `−${num(quote.total)}` : `≈ −${num(Math.round(p.estimate))}`}
              </small>
            )}
          </div>
          <div role="cell" className="mk-c-act">
            {full && (
              <button
                type="button"
                className="btn small mk-quick"
                disabled={busy || full.qty <= 0}
                title={full.qty > 0 ? t("mk.buyMaxHint", { total: money(Math.round(p.fullCost)) }) : tk(`mk.limit.${full.limit}`)}
                onClick={p.onBuyMax}
              >
                {full.qty > 0 ? t("mk.buyMax", { n: num(full.qty) }) : tk(`mk.limitShort.${full.limit}`)}
              </button>
            )}
          </div>
        </>
      ) : null}
      {p.note && (
        <div role="cell" className="mk-c-note" data-testid={`mk-note-${row.good}`}>
          {p.note}
        </div>
      )}
    </Row>
  );
}

export interface SellRowProps {
  port: PortView;
  line: CargoLine;
  row: MarketRow | undefined;
  good: GoodView | undefined;
  live: boolean;
  busy: boolean;
  staged: number;
  quote: TradeQuote | undefined;
  block: SellBlock | null;
  open: boolean;
  active: boolean;
  flash?: number;
  note?: string;
  setQty: (n: number) => void;
  onSellAll: () => void;
  onToggle: () => void;
  onFocusRow: () => void;
  rowRef: (el: HTMLDivElement | null) => void;
}

/** 卖出页的一行：持有、成本、此地收购价（估价）与全部卖出的盈亏；此地不收的也列出并注明。 */
export function SellRow(p: SellRowProps) {
  const { port, line, row, good, live, busy, staged, quote, block, open } = p;
  const name = good?.name ?? String(line.good);
  const unit = row ? unitEstimate(port, row, "sell") : 0;
  const held = t("mk.heldLine", { qty: num(line.qty), cost: num(line.avg_cost) });
  if (block === "notTraded") {
    return (
      <Row
        good={line.good}
        testId={`sell-row-${line.good}`}
        open={open}
        active={p.active}
        staged={0}
        flash={p.flash}
        extra="mk-off"
        onToggle={p.onToggle}
        onFocusRow={p.onFocusRow}
        rowRef={p.rowRef}
      >
        <GoodName good={good} id={line.good} row={row} sub={held} />
        <div role="cell" className="mk-c-why mk-off-note">
          {t("mk.notTraded")}
        </div>
      </Row>
    );
  }
  return (
    <Row
      good={line.good}
      testId={`sell-row-${line.good}`}
      open={open}
      active={p.active}
      staged={staged}
      flash={p.flash}
      extra={block ? "mk-blocked" : undefined}
      onToggle={p.onToggle}
      onFocusRow={p.onFocusRow}
      rowRef={p.rowRef}
    >
      <GoodName good={good} id={line.good} row={row} sub={held} />
      {row && <PriceBlock row={row} value={unit} area="bid" hint={t("mk.bidHint")} />}
      <div role="cell" className="mk-c-profit" title={t("mk.profitHint", { unit: num(Math.round(unit - line.avg_cost)) })}>
        <span className="mk-lbl">{t("mk.profit")}</span>
        <Profit value={(unit - line.avg_cost) * line.qty} testId={`sell-profit-${line.good}`} />
      </div>
      {block ? (
        <div role="cell" className="mk-c-why" title={t(`mk.blockHint.${block}`)}>
          {t(`mk.block.${block}`)}
        </div>
      ) : (
        <>
          <div role="cell" className="mk-c-qty">
            {live && !open && (
              <QtyStepper
                value={staged}
                max={line.qty}
                onChange={p.setQty}
                label={t("mk.qtySell", { good: name })}
                decLabel={t("mk.decSell")}
                incLabel={t("mk.incSell")}
                disabled={busy}
                testId={`mk-step-${line.good}`}
              />
            )}
            {live && staged > 0 && !open && (
              <small className="mk-line-total gain" data-testid={`mk-line-${line.good}`}>
                {quote ? `+${num(quote.total)}` : `≈ +${num(Math.round(unit * staged))}`}
              </small>
            )}
          </div>
          <div role="cell" className="mk-c-act">
            {live && (
              <button
                type="button"
                className="btn small mk-quick"
                disabled={busy}
                title={t("mk.sellRowHint", { total: money(Math.round(unit * line.qty)) })}
                onClick={p.onSellAll}
              >
                {t("mk.sellRow")}
              </button>
            )}
          </div>
        </>
      )}
      {p.note && (
        <div role="cell" className="mk-c-note" data-testid={`mk-note-${line.good}`}>
          {p.note}
        </div>
      )}
    </Row>
  );
}
