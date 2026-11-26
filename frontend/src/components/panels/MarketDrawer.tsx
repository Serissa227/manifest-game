// 交易所里展开的一行（点行即展开，就在这一行下面，不用往下翻）：这种货的需求层级、数量（滑块、输入框、快捷数量）、
// 与内核同一套计算的精确预估与“只成交这一行”，价格走势或预测，以及自己知道的别处的价格（哪里卖得好）。
// 这里的数量就是这一行在成交单里的数量：在这里调了，收起后行里、底下的成交单里都是这个数；打开明细本身不往成交单里放东西。
import { useState, type FormEvent } from "react";
import { money, num, t, tk } from "../../i18n";
import { api } from "../../ipc/api";
import { locById } from "../../ipc/byId";
import type { GoodView, MarketRow, PortView, SeriesView, TradeQuote } from "../../ipc/types";
import { useView } from "../../hooks/useView";
import { useForecast } from "../../store/forecast";
import { useGame } from "../../store/game";
import MarketForecast from "../analysis/MarketForecast";
import { LineChart } from "../Chart";
import { NumInput } from "../common";
import { EmptyState } from "../feedback";
import { openWindow } from "../shell/shellState";
import { tz } from "../../i18n/zhOnly";
import { bpPct, seenLabel } from "./marketInfo";
import { Profit } from "./MarketRows";
import { ELSEWHERE_SHOWN, pickPlaces, type Side } from "./trade";

/**
 * 别处的价格：自己知道行情的地方（到过或有消息的港口），写明是几天前的消息与航程。只在展开时问一次。
 * 卖出页列卖这种货最贵的三处（开放市场：哪里都收）；买入页列出售这种货、最便宜的三处（开放市场：只看那里出售的）。
 * 挑哪几处见 trade.ts 的 pickPlaces。
 */
function Elsewhere({ loc, good, here, side }: { loc: number; good: number; here: number | null; side: Side }) {
  const statics = useGame((s) => s.statics);
  const { data } = useView(
    `mkelsewhere:${loc}:${good}:${side}`,
    async () => {
      // 只是参考：取不到（旧后端、还没有预测簿）时当作不知道，不弹错误
      const book = await api.forecastBook().catch(() => null);
      const { places } = pickPlaces(book?.places ?? [], loc, good, side);
      const got = await Promise.all(places.map((p) => api.marketSeries(p.loc, good).catch(() => null)));
      // T04：预测簿的地点另给这种货在那里比常价贵还是便宜（万分之一）
      const vsNormal = new Map<number, number>();
      for (const p of places) {
        const i = p.goods.indexOf(good);
        const bp = i >= 0 ? p.vs_normal_bp?.[i] : undefined;
        if (typeof bp === "number") vsNormal.set(p.loc, bp);
      }
      const list = got.filter((s): s is SeriesView => !!s).sort((a, b) => (side === "buy" ? a.price - b.price : b.price - a.price));
      return list.map((s) => ({ s, vs: vsNormal.get(s.loc) ?? null }));
    },
    false,
  );
  if (!data) return null;
  if (data.length === 0) {
    return (
      <p className="mk-else sub" data-testid="mk-elsewhere">
        {side === "buy" ? t("mk.elsewhereNoneBuy") : t("mk.elsewhereNone")}
      </p>
    );
  }
  const better = (price: number) => here !== null && (side === "buy" ? price < here : price > here);
  return (
    <div className="mk-else" data-testid="mk-elsewhere">
      <span className="mk-else-title">{side === "buy" ? t("mk.elsewhereBuy") : t("mk.elsewhere")}</span>
      <ul>
        {data.slice(0, ELSEWHERE_SHOWN).map(({ s, vs }) => (
          <li key={s.loc} className={better(s.price) ? "better" : ""}>
            <strong>{locById(statics, s.loc)?.name ?? String(s.loc)}</strong> <span className="mk-else-price">{money(s.price)}</span>
            {vs !== null && bpPct(vs) !== 0 && (
              <small className="mk-else-vs">{tz("mk.vsNormal", { sign: vs > 10_000 ? "+" : "", pct: bpPct(vs) })}</small>
            )}
            <small>
              {s.seen ? seenLabel(s.seen) : t("mk.elsewhereLive")}
              {s.voyage_days != null && ` · ${t("mk.elsewhereVoyage", { days: s.voyage_days })}`}
            </small>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 这种货从哪里来（开放市场）：这里不出产时写明最近的产地与贸易距离——离产地越远，均衡库存越少、价格越高；
 * 这里只收不卖时另说一句。旧后端没有这些字段时什么也不写。
 */
function Origin({ row }: { row: MarketRow }) {
  const statics = useGame((s) => s.statics);
  if (row.specialty || (!row.nearest && row.sold !== false)) return null;
  const place = row.nearest ? (locById(statics, row.nearest[0])?.name ?? String(row.nearest[0])) : null;
  return (
    <p className="sub mk-origin" data-testid="mk-origin">
      {row.sold === false && (
        <>
          {t("mk.onlyBuys")}
          <br />
        </>
      )}
      {place && row.nearest ? t("mk.origin", { place, dist: num(Math.round(row.nearest[1])) }) : t("mk.originFar")}
    </p>
  );
}

export interface DrawerProps {
  port: PortView;
  row: MarketRow | undefined;
  good: number;
  goodView: GoodView | undefined;
  side: Side;
  /** 此地有自己的持有者 */
  hasHolder: boolean;
  /** 可以交易（有持有者、在这里、这一行没被禁运或许可证挡住、件数上限大于 0） */
  canTrade: boolean;
  /** 不能交易时的说明 */
  why: string;
  held: number;
  avgCost: number;
  max: number;
  qty: number;
  quote: TradeQuote | undefined;
  busy: boolean;
  setQty: (n: number) => void;
  onTrade: (qty: number) => void;
}

export default function MarketDrawer(p: DrawerProps) {
  const { port, row, good, goodView, side, max, qty, quote } = p;
  // 价格图上方的“预测”开关：打开时换成带预测线与区间的图
  const [forecastOn, setForecastOn] = useState(false);
  const n = Math.max(0, Math.min(qty, max));
  const line = (q: TradeQuote | undefined) =>
    q && n > 0 ? t("mkPreviewLine", { avg: num(q.avg_price), tax: num(q.tax), total: num(q.total), before: q.price_before, after: q.price_after }) : "—";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (p.canTrade && n > 0 && !p.busy) p.onTrade(n);
  };
  const half = Math.max(1, Math.floor(max / 2));
  const presets: [string, number][] =
    side === "sell"
      ? [
          [t("mk.half"), half],
          [t("mk.all"), max],
        ]
      : [
          ["10", Math.min(10, max)],
          [t("mk.half"), half],
          [t("mk.max"), max],
        ];
  const total = quote && n > 0 && quote.qty === n ? money(quote.total) : "…";

  return (
    <div role="row" className="mk-drawer-row">
      <div role="cell" className="mk-drawer trade" data-testid="trade-form" aria-label={`${goodView?.name ?? String(good)} · ${side === "sell" ? t("mkSell") : t("mkBuy")}`}>
        {goodView?.need && (
          <p className="sub mk-need" data-testid="market-need">
            {tk(`need.${goodView.need}`)}
          </p>
        )}
        {!p.hasHolder ? (
          // 新界面：说明怎样才能在这里买卖，“下一步”切到这个港口的仓库（租下就能交易）；旧界面照旧一行字
          <EmptyState
            className="is-compact"
            text={t("mkNoHolder")}
            hint={t("v2.port.mk.noHolderHint")}
            action={{ label: t("v2.port.mk.toWarehouse"), onClick: () => useGame.getState().setFacility("warehouse") }}
          />
        ) : !row ? (
          <p className="hint" data-testid="mk-not-traded">
            {t("mk.notTradedLong")}
          </p>
        ) : p.canTrade ? (
          <form className="mk-qty" onSubmit={submit} data-testid="mk-qty">
            <div className="mk-qty-row">
              <input
                type="range"
                className="mk-slider"
                aria-label={t("mk.qtySlider")}
                min={0}
                max={max}
                step={1}
                value={n}
                disabled={p.busy}
                onChange={(e) => p.setQty(Math.trunc(Number(e.target.value)))}
              />
              <NumInput label={t("mkQty")} value={n} min={0} max={max} onChange={(v) => p.setQty(Math.max(0, Math.min(max, v)))} />
            </div>
            <div className="mk-presets" role="group" aria-label={t("mk.presets")}>
              {presets.map(([label, v]) => (
                <button key={label} type="button" className="btn small" aria-pressed={n === v} disabled={p.busy} onClick={() => p.setQty(v)}>
                  {label}
                </button>
              ))}
              {n > 0 && (
                <button type="button" className="btn small mk-zero" disabled={p.busy} onClick={() => p.setQty(0)}>
                  {t("mk.zero")}
                </button>
              )}
            </div>
            <p className="preview" data-testid={`preview-${side}`}>
              {side === "sell" ? t("mkSell") : t("mkBuy")}：{line(quote)}
            </p>
            {side === "sell" && quote && n > 0 && p.held > 0 && (
              <p className="preview" data-testid="preview-profit">
                {t("mk.profitLine")} <Profit value={quote.total - p.avgCost * n} />
              </p>
            )}
            <div className="mk-qty-actions">
              <button type="submit" className="btn primary mk-confirm" disabled={p.busy || n <= 0}>
                {n <= 0
                  ? t("mk.pickQty")
                  : side === "sell"
                    ? t("mk.confirmSell", { qty: num(n), total })
                    : t("mk.confirmBuy", { qty: num(n), total })}
              </button>
              {n > 0 && <span className="sub mk-in-cart">{t("mk.inCart")}</span>}
            </div>
          </form>
        ) : (
          <p className="hint" data-testid="mk-cannot">
            {p.why}
          </p>
        )}
        {row && <Origin row={row} />}
        {row && <Elsewhere loc={port.loc} good={good} here={row.price} side={side} />}
        <div className="row mk-chart-tools">
          <label className="mk-forecast-toggle">
            <input type="checkbox" checked={forecastOn} onChange={(e) => setForecastOn(e.target.checked)} />
            {t("fc.mkToggle")}
          </label>
          {row && (
            <button
              type="button"
              className="btn small"
              onClick={() => {
                useForecast.getState().select(port.loc, good);
                useForecast.getState().setView("work");
                openWindow("analysis");
              }}
            >
              {t("fc.mkMore")}
            </button>
          )}
        </div>
        {row &&
          (forecastOn ? (
            <MarketForecast loc={port.loc} good={good} />
          ) : (
            <LineChart labels={row.history.map((_, i) => String(i - row.history.length + 1))} series={[{ name: t("mkTrend"), data: row.history }]} height={120} />
          ))}
      </div>
    </div>
  );
}
