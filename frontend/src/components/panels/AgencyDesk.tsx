// 仓库页的“代办”一栏（T03 商馆代办）：在这座港口挂限价单，日结时按当天的价格替你成交。
// 买单：成交均价不高于限价才买，钱先从现金里预留（撤单原样退回）；卖单：成交均价不低于限价才从这里的仓库卖。
// 挂单、撤单都是一次点击；下面列出挂着的单（没成交的写原因）与最近的成交。数字全部来自内核（WarehouseView.agency）。
// FE1（T04 的账）：每张单写累计成交了多少钱、代办费，卖单另写盈亏；最近的成交里卖出写成本与盈亏；最下面是本港的代办小账。
// 这些账只记录、不参与结算，成本按成交时的均价摊，界面写明是估算。
import { useState } from "react";
import { dayDate, money, nameOf, num } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import type { AgencyLedgerView, AgencyView } from "../../ipc/types";
import { useGame } from "../../store/game";
import { ActionButton, NumInput, Section } from "../common";
import { reserveFor } from "./agencyKit";
import { Profit } from "./MarketRows";

/** 本港的代办小账（T04；永久累计，只记录）：还没成交过时不画。 */
function LedgerLine({ ledger }: { ledger: AgencyLedgerView }) {
  if (ledger.buy_qty === 0 && ledger.sell_qty === 0) return null;
  return (
    <div className="agency-ledger" data-testid="agency-ledger">
      <h5 title={tz("agency.ledgerHint")}>{tz("agency.ledger")}</h5>
      <p className="sub">
        {ledger.buy_qty > 0 && <span>{tz("agency.ledgerBuy", { qty: num(ledger.buy_qty), total: money(ledger.buy_total) })}</span>}
        {ledger.sell_qty > 0 && (
          <span>{tz("agency.ledgerSell", { qty: num(ledger.sell_qty), total: money(ledger.sell_total), cost: money(ledger.sell_cost) })}</span>
        )}
        <span>{tz("agency.ledgerFees", { v: money(ledger.fees) })}</span>
        {ledger.sell_qty > 0 && (
          <span>
            {tz("agency.ledgerProfit")} <Profit value={ledger.profit} testId="agency-ledger-profit" />
          </span>
        )}
      </p>
    </div>
  );
}


/** 没成交的原因写成一句话。 */
function waitingText(code: string): string {
  switch (code) {
    case "agency.price":
      return tz("agency.wait.price");
    case "agency.reserve":
      return tz("agency.wait.reserve");
    case "agency.capacity":
      return tz("agency.wait.capacity");
    case "agency.stock":
      return tz("agency.wait.stock");
    case "trade.license":
      return tz("agency.wait.license");
    default:
      return code.startsWith("access.") || code.startsWith("rank") ? tz("agency.wait.rank") : tz("agency.wait.other", { code });
  }
}

export default function AgencyDesk({ loc, agency }: { loc: number; agency: AgencyView }) {
  const statics = useGame((s) => s.statics);
  const cash = useGame((s) => s.overview?.cash ?? 0);
  const submit = useGame((s) => s.submit);
  const setFacility = useGame((s) => s.setFacility);
  const first = agency.goods[0];
  const [good, setGood] = useState<number>(first?.good ?? 0);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const line = agency.goods.find((g) => g.good === good) ?? first;
  const [limit, setLimit] = useState<number>(line?.price ?? 1);
  const [qty, setQty] = useState<number>(10);
  if (!statics) return null;
  const goodName = (g: number) => (statics.goods[g] ? nameOf(statics.goods[g]) : `#${g}`);
  const full = agency.used >= agency.slots;
  const reserve = line ? reserveFor(limit, qty, line.tax_bp, agency.fee_pct) : 0;
  const short = side === "buy" ? reserve > cash : qty > (line?.stock ?? 0);
  const pick = (g: number) => {
    setGood(g);
    const l = agency.goods.find((x) => x.good === g);
    if (l) setLimit(l.price);
  };
  const place = () =>
    void submit({ PlaceOrder: { owner: "player", loc, good, side: side === "buy" ? "Buy" : "Sell", limit, qty } });
  return (
    <Section title={tz("agency.title")}>
      <div className="agency" data-testid="agency">
        <p className="sub agency-head" data-testid="agency-slots">
          {tz("agency.slots", { used: agency.used, slots: agency.slots, per: agency.per_level, fee: agency.fee_pct })}
          {(agency.stage_bonus ?? 0) > 0 && <> {tz("agency.stageBonus", { n: agency.stage_bonus ?? 0 })}</>}
        </p>
        {agency.slots === 0 ? (
          <p className="hint" data-testid="agency-no-house">
            {tz("agency.noHouse", { per: agency.per_level })}{" "}
            <button type="button" className="btn small" onClick={() => setFacility("invest")}>
              {tz("agency.goInvest")}
            </button>
          </p>
        ) : (
          <div className="row agency-form" data-testid="agency-form">
            <div className="seg" role="group" aria-label={tz("agency.side")}>
              <button type="button" className={side === "buy" ? "btn small on" : "btn small"} aria-pressed={side === "buy"} onClick={() => setSide("buy")}>
                {tz("agency.buy")}
              </button>
              <button type="button" className={side === "sell" ? "btn small on" : "btn small"} aria-pressed={side === "sell"} onClick={() => setSide("sell")}>
                {tz("agency.sell")}
              </button>
            </div>
            <label className="agency-good">
              <span className="sub">{tz("agency.good")}</span>
              <select value={good} onChange={(e) => pick(Number(e.target.value))} data-testid="agency-good">
                {agency.goods.map((g) => (
                  <option key={g.good} value={g.good}>
                    {tz("agency.goodOption", { name: goodName(g.good), price: num(g.price), stock: g.stock })}
                  </option>
                ))}
              </select>
            </label>
            <NumInput label={tz("agency.limit")} value={limit} min={1} step={1} onChange={(v) => setLimit(Math.max(1, v))} />
            <NumInput label={tz("agency.qty")} value={qty} min={1} step={10} onChange={(v) => setQty(Math.max(1, v))} />
            <span className={short ? "warn agency-cost" : "sub agency-cost"} data-testid="agency-cost">
              {side === "buy"
                ? tz(short ? "agency.reserveShort" : "agency.reserve", { v: money(reserve) })
                : tz(short ? "agency.stockShort" : "agency.stockHave", { n: line?.stock ?? 0 })}
            </span>
            <ActionButton kind="primary" disabled={full || short || !line} onClick={place}>
              {full ? tz("agency.full") : tz("agency.place")}
            </ActionButton>
          </div>
        )}
        {agency.orders.length > 0 && (
          <ul className="agency-orders" data-testid="agency-orders">
            {agency.orders.map((o) => (
              <li key={o.id} data-testid={`agency-order-${o.id}`}>
                <strong>{tz(o.side === "buy" ? "agency.rowBuy" : "agency.rowSell", { good: goodName(o.good), limit: num(o.limit) })}</strong>
                <span>{tz("agency.rowQty", { filled: o.filled, total: o.filled + o.qty })}</span>
                {o.reserved > 0 && <span className="sub">{tz("agency.rowReserved", { v: money(o.reserved) })}</span>}
                {(o.done_total ?? 0) > 0 && (
                  <span className="sub" title={tz("agency.estimateHint")}>
                    {tz(o.side === "buy" ? "agency.rowDoneBuy" : "agency.rowDoneSell", { total: money(o.done_total ?? 0), fee: money(o.done_fee ?? 0) })}
                  </span>
                )}
                {o.side === "sell" && typeof o.profit === "number" && (o.done_total ?? 0) > 0 && (
                  <span className="sub" title={tz("agency.profitHint", { cost: money(o.done_cost ?? 0) })}>
                    {tz("agency.rowProfit")} <Profit value={o.profit} testId={`agency-order-${o.id}-profit`} />
                  </span>
                )}
                {o.waiting && <span className="sub agency-wait">{waitingText(o.waiting)}</span>}
                <ActionButton onClick={() => void submit({ CancelOrder: { owner: "player", order: o.id } })}>{tz("agency.cancel")}</ActionButton>
              </li>
            ))}
          </ul>
        )}
        {agency.fills.length > 0 && (
          <div className="agency-fills" data-testid="agency-fills">
            <h5>{tz("agency.fills")}</h5>
            <ul>
              {agency.fills.map((f, i) => (
                <li key={`${f.day}-${i}`}>
                  {tz(f.side === "buy" ? "agency.fillBuy" : "agency.fillSell", {
                    day: dayDate(f.day),
                    good: goodName(f.good),
                    qty: f.qty,
                    total: money(f.total),
                    fee: money(f.fee),
                  })}
                  {f.side === "sell" && typeof f.profit === "number" && (
                    <span className="sub" title={tz("agency.profitHint", { cost: money(f.cost ?? 0) })}>
                      {" · "}
                      {tz("agency.rowProfit")} <Profit value={f.profit} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {agency.ledger && <LedgerLine ledger={agency.ledger} />}
      </div>
    </Section>
  );
}
