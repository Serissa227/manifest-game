// 报表窗口：资产走势、三大报表（月报 / 年报）、当前资产负债表；货币流通打开时另有经济月报。
// 新界面（v2）的小改动（旧界面不变）：还没有结账的报表时空状态写明什么时候会有；
// 经济月报的多列表格的格子带 data-label（手机上一行变成一张小卡，每个数前写着是什么，见 ui-v2/analysis.css）。
// FE1（T04 的两本账）：“跑过的航线”（按出发港 → 到达港归集：趟数、海上天数、卖出所得、货的成本、海上开销、盈亏与每天）
// 与“各港代办”（买进、卖出、成本、代办费、盈亏）；两本都是估算，只记录、不进上面的三大报表，表头下写明。
import { useState } from "react";
import { decimal, money, num, pct, t, tk } from "../../i18n";
import { api } from "../../ipc/api";
import { tz } from "../../i18n/zhOnly";
import { locById } from "../../ipc/byId";
import type { AccountLine, AgencyLedgerView, BalanceSheet, EconomyReportView, FinancialReport, RouteLineView } from "../../ipc/types";
import { useGame } from "../../store/game";
import { useView } from "../../hooks/useView";
import { useIsV2 } from "../../ui/uiMode";
import { LineChart } from "../Chart";
import { TabBar } from "../common";
import { EmptyState } from "../feedback";
import { Profit } from "./MarketRows";
import { PnSection } from "./PanelKit";

/** 航线账一次先列几条（其余点开看）。 */
const ROUTES_SHOWN = 10;

/** T04 航线账：一条有向航线一行；最近跑过的在前（后端已排好）。 */
function RoutesSection({ routes }: { routes: RouteLineView[] }) {
  const statics = useGame((s) => s.statics);
  const v2 = useIsV2();
  const [all, setAll] = useState(false);
  const cell = (label: string) => (v2 ? { "data-label": label } : {});
  const name = (id: number) => locById(statics, id)?.name ?? `#${id}`;
  const shown = all ? routes : routes.slice(0, ROUTES_SHOWN);
  return (
    <PnSection title={tz("rp.routes.title")} icon="report" testId="report-routes" className="pn-ledger pn-economy pn-routes">
      <p className="sub pn-estimate">{tz("rp.routes.note")}</p>
      <table className="grid statement" data-testid="report-routes-table">
        <thead>
          <tr className="head">
            <th>{tz("rp.routes.th.route")}</th>
            <th>{tz("rp.routes.th.trips")}</th>
            <th>{tz("rp.routes.th.days")}</th>
            <th title={tz("rp.routes.th.soldHint")}>{tz("rp.routes.th.sold")}</th>
            <th title={tz("rp.routes.th.costHint")}>{tz("rp.routes.th.cost")}</th>
            <th title={tz("rp.routes.th.seaHint")}>{tz("rp.routes.th.sea")}</th>
            <th>{tz("rp.routes.th.profit")}</th>
            <th>{tz("rp.routes.th.perDay")}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={`${r.from}-${r.to}`}>
              <td>{tz("rp.routes.path", { from: name(r.from), to: name(r.to) })}</td>
              <td className="num" {...cell(tz("rp.routes.th.trips"))}>
                {num(r.trips)}
              </td>
              <td className="num" {...cell(tz("rp.routes.th.days"))}>
                {num(r.days)}
              </td>
              <td className="num" {...cell(tz("rp.routes.th.sold"))}>
                {money(r.sold_total)}
              </td>
              <td className="num" {...cell(tz("rp.routes.th.cost"))}>
                {money(r.sold_cost)}
              </td>
              <td className="num" {...cell(tz("rp.routes.th.sea"))}>
                {money(r.sea_cost)}
              </td>
              <td className="num" {...cell(tz("rp.routes.th.profit"))}>
                <Profit value={r.profit} />
              </td>
              <td className="num" {...cell(tz("rp.routes.th.perDay"))}>
                <Profit value={r.per_day} />
              </td>
            </tr>
          ))}
          {routes.length > ROUTES_SHOWN && (
            <tr>
              <td colSpan={8} className="sub">
                <button type="button" className="btn small" onClick={() => setAll(!all)}>
                  {all ? tz("rp.routes.less") : tz("rp.routes.more", { n: routes.length - ROUTES_SHOWN })}
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </PnSection>
  );
}

/** T04 代办账：每港一行（只列成交过的港）。 */
function AgencyBooksSection({ books }: { books: AgencyLedgerView[] }) {
  const statics = useGame((s) => s.statics);
  const v2 = useIsV2();
  const cell = (label: string) => (v2 ? { "data-label": label } : {});
  const rows = books.filter((b) => b.buy_qty > 0 || b.sell_qty > 0);
  if (rows.length === 0) return null;
  return (
    <PnSection title={tz("rp.agency.title")} icon="report" testId="report-agency" className="pn-ledger pn-economy pn-agency-books">
      <p className="sub pn-estimate">{tz("rp.agency.note")}</p>
      <table className="grid statement" data-testid="report-agency-table">
        <thead>
          <tr className="head">
            <th>{tz("rp.agency.th.port")}</th>
            <th>{tz("rp.agency.th.buy")}</th>
            <th>{tz("rp.agency.th.sell")}</th>
            <th>{tz("rp.agency.th.cost")}</th>
            <th>{tz("rp.agency.th.fees")}</th>
            <th>{tz("rp.agency.th.profit")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.loc}>
              <td>{locById(statics, b.loc)?.name ?? `#${b.loc}`}</td>
              <td className="num" {...cell(tz("rp.agency.th.buy"))}>
                {tz("rp.agency.qtyMoney", { qty: num(b.buy_qty), total: money(b.buy_total) })}
              </td>
              <td className="num" {...cell(tz("rp.agency.th.sell"))}>
                {tz("rp.agency.qtyMoney", { qty: num(b.sell_qty), total: money(b.sell_total) })}
              </td>
              <td className="num" {...cell(tz("rp.agency.th.cost"))}>
                {money(b.sell_cost)}
              </td>
              <td className="num" {...cell(tz("rp.agency.th.fees"))}>
                {money(b.fees)}
              </td>
              <td className="num" {...cell(tz("rp.agency.th.profit"))}>
                <Profit value={b.profit} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </PnSection>
  );
}

function Lines({ lines }: { lines: AccountLine[] }) {
  return (
    <>
      {lines.map(([acc, v]) => (
        <tr key={acc}>
          <td>{tk(`account.${acc}`)}</td>
          <td className="num">{money(v)}</td>
        </tr>
      ))}
    </>
  );
}

function BalanceTable({ b }: { b: BalanceSheet }) {
  return (
    <table className="grid statement" data-testid="balance-sheet">
      <tbody>
        <tr className="head">
          <th colSpan={2}>{t("rpAssets")}</th>
        </tr>
        <Lines lines={b.assets} />
        <tr className="total">
          <td>{t("rpTotal")}</td>
          <td className="num">{money(b.total_assets)}</td>
        </tr>
        <tr className="head">
          <th colSpan={2}>{t("rpLiabilities")}</th>
        </tr>
        <Lines lines={b.liabilities} />
        <tr className="total">
          <td>{t("rpTotal")}</td>
          <td className="num">{money(b.total_liabilities)}</td>
        </tr>
        <tr className="head">
          <th colSpan={2}>{t("rpEquity")}</th>
        </tr>
        <Lines lines={b.equity} />
        <tr>
          <td>{t("rpCurrentEarnings")}</td>
          <td className="num">{money(b.current_earnings)}</td>
        </tr>
        <tr className="total">
          <td>{t("rpTotal")}</td>
          <td className="num">{money(b.total_equity)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function Report({ r }: { r: FinancialReport }) {
  const i = r.income;
  const c = r.cash_flow;
  return (
    <div className="report pn-report">
      <p className="sub">{t("rpPeriod", { start: r.start_day, end: r.end_day })}</p>
      <PnSection title={t("rpIncome")} icon="coin" testId="income-statement" className="pn-ledger">
        <table className="grid statement">
          <tbody>
            <tr className="head">
              <th colSpan={2}>{t("rpRevenue")}</th>
            </tr>
            <Lines lines={i.revenues} />
            <tr className="total">
              <td>{t("rpTotal")}</td>
              <td className="num">{money(i.total_revenue)}</td>
            </tr>
            <tr className="head">
              <th colSpan={2}>{t("rpExpense")}</th>
            </tr>
            <Lines lines={i.expenses} />
            <tr className="total">
              <td>{t("rpTotal")}</td>
              <td className="num">{money(i.total_expense)}</td>
            </tr>
            <tr className="total">
              <td>{t("rpNetIncome")}</td>
              <td className={i.net_income >= 0 ? "num up" : "num down"}>{money(i.net_income)}</td>
            </tr>
          </tbody>
        </table>
      </PnSection>
      <PnSection title={t("rpBalance")} icon="bank" className="pn-ledger">
        <BalanceTable b={r.balance_sheet} />
      </PnSection>
      <PnSection title={t("rpCashFlow")} icon="coin" testId="cash-flow" className="pn-ledger">
        <table className="grid statement">
          <tbody>
            {(
              [
                ["rpOpening", c.opening_cash],
                ["rpOperating", c.operating],
                ["rpInvesting", c.investing],
                ["rpFinancing", c.financing],
                ["rpNetChange", c.net_change],
                ["rpClosing", c.closing_cash],
              ] as const
            ).map(([k, v]) => (
              <tr key={k}>
                <td>{t(k)}</td>
                <td className="num">{money(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </PnSection>
    </div>
  );
}

/** 经济月报里最多列出的资金流条数（其余合成一句“另有 n 类”）。 */
const FLOWS_SHOWN = 12;

/** 经济月报（货币流通，ECONOMY.md 6.9）：各部门的余额与流入流出、货币总量、物价指数、产量与人口、各势力国库。 */
function EconomySection({ reports }: { reports: EconomyReportView[] }) {
  const [month, setMonth] = useState<number | null>(null);
  const v2 = useIsV2();
  /** v2：格子前的小标签（手机上表格变成卡片时显示）；v1 不加属性 */
  const cell = (label: string) => (v2 ? { "data-label": label } : {});
  const r = reports.find((x) => x.month === month) ?? reports[reports.length - 1];
  const times = (bp: number) => decimal(bp / 10_000);
  const place = (x: [string, number] | null) => (x ? t("econ.place", { name: x[0], mult: times(x[1]) }) : "—");
  const flows = r.flows.slice(0, FLOWS_SHOWN);
  const stats: [string, string][] = [
    [t("econ.supply"), money(r.money_supply)],
    [t("econ.player"), money(r.player)],
    [t("econ.companies"), money(r.companies)],
    [t("econ.exchange"), money(r.exchange)],
    [t("econ.priceIndex"), times(r.price_index_bp)],
    [t("econ.production"), num(r.production)],
    [t("econ.population"), num(r.population)],
    [t("econ.shortfall"), money(r.shortfall)],
    [t("econ.tightest"), place(r.tightest)],
    [t("econ.flush"), place(r.flush)],
  ];
  return (
    <PnSection title={t("econ.title")} icon="report" testId="economy-report" className="pn-ledger pn-economy">
      <div className="pn-chart-frame">
        <LineChart
          testId="money-supply-trend"
          labels={reports.map((x) => String(x.day))}
          series={[{ name: t("econ.trend"), data: reports.map((x) => x.money_supply) }]}
        />
      </div>
      <select className="pn-period" aria-label={t("econ.pick")} value={r.month} onChange={(e) => setMonth(Number(e.target.value))}>
        {reports.map((x) => (
          <option key={x.month} value={x.month}>
            {t("econ.monthOf", { day: x.day })}
          </option>
        ))}
      </select>
      <table className="grid statement" data-testid="economy-sectors">
        <thead>
          <tr className="head">
            <th>{t("econ.sector")}</th>
            <th>{t("econ.opening")}</th>
            <th>{t("econ.inflow")}</th>
            <th>{t("econ.outflow")}</th>
            <th>{t("econ.closing")}</th>
          </tr>
        </thead>
        <tbody>
          {r.sectors.map((s) => (
            <tr key={s.kind}>
              <td>{tk(`econ.sector.${s.kind}`)}</td>
              <td className="num" {...cell(t("econ.opening"))}>
                {money(s.opening)}
              </td>
              <td className="num" {...cell(t("econ.inflow"))}>
                {money(s.inflow)}
              </td>
              <td className="num" {...cell(t("econ.outflow"))}>
                {money(s.outflow)}
              </td>
              <td className="num" {...cell(t("econ.closing"))}>
                {money(s.closing)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="econ-stats" data-testid="economy-stats">
        {stats.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <table className="grid statement" data-testid="economy-flows">
        <thead>
          <tr className="head">
            <th colSpan={3}>{t("econ.flows")}</th>
          </tr>
        </thead>
        <tbody>
          {flows.map((l) => (
            <tr key={`${l.flow}-${l.from}-${l.to}`}>
              <td>{tk(`econ.flow.${l.flow}`)}</td>
              <td>{t("econ.flowPath", { from: tk(`econ.sector.${l.from}`), to: tk(`econ.sector.${l.to}`) })}</td>
              <td className="num">{money(l.amount)}</td>
            </tr>
          ))}
          {r.flows.length > FLOWS_SHOWN && (
            <tr>
              <td colSpan={3} className="sub">
                {t("econ.more", { n: r.flows.length - FLOWS_SHOWN })}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <table className="grid statement" data-testid="economy-treasuries">
        <thead>
          <tr className="head">
            <th>{t("econ.th.faction")}</th>
            <th>{t("econ.th.money")}</th>
            <th>{t("econ.th.tax")}</th>
            <th>{t("econ.th.patrol")}</th>
            <th>{t("econ.th.income")}</th>
            <th>{t("econ.th.spent")}</th>
          </tr>
        </thead>
        <tbody>
          {r.treasuries.map((x) => (
            <tr key={x.faction}>
              <td>{x.faction}</td>
              <td className={x.money >= 0 ? "num" : "num down"} {...cell(t("econ.th.money"))}>
                {money(x.money)}
              </td>
              <td className="num" {...cell(t("econ.th.tax"))}>
                ×{times(x.tax_mult_bp)}
              </td>
              <td className="num" {...cell(t("econ.th.patrol"))}>
                {pct(x.patrol_bp, 0)}%
              </td>
              <td className="num" {...cell(t("econ.th.income"))}>
                {money(x.income)}
              </td>
              <td className="num" {...cell(t("econ.th.spent"))}>
                {money(x.spent)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </PnSection>
  );
}

/** 报表：三大报表，按月 / 按年切换，资产走势图；货币流通打开时另有经济月报。 */
export default function ReportsPanel() {
  const { data } = useView("reports", () => api.reports());
  const [period, setPeriod] = useState<"month" | "year">("month");
  const [index, setIndex] = useState<number | null>(null);
  if (!data) return null;
  const list = period === "month" ? data.monthly : data.yearly;
  const chosen = list.find((r) => r.index === index) ?? list[list.length - 1];
  return (
    <div data-testid="reports-panel" className="pn pn-reports">
      <PnSection title={t("rpTrend")} icon="report" className="pn-trend">
        <div className="pn-chart-frame">
          <LineChart
          testId="asset-trend"
          labels={data.trend.map((p) => String(p.day))}
          series={[
            { name: t("rpTrendAssets"), data: data.trend.map((p) => p.total_assets) },
            { name: t("rpTrendEquity"), data: data.trend.map((p) => p.equity) },
          ]}
          />
        </div>
      </PnSection>
      {data.routes && data.routes.length > 0 && <RoutesSection routes={data.routes} />}
      {data.agency_books && data.agency_books.length > 0 && <AgencyBooksSection books={data.agency_books} />}
      <TabBar
        label={t("rpIncome")}
        items={[
          { key: "month", label: t("rpMonthly") },
          { key: "year", label: t("rpYearly") },
        ]}
        active={period}
        onSelect={(p) => {
          setPeriod(p);
          setIndex(null);
        }}
      />
      {list.length > 0 && (
        <select
          className="pn-period"
          aria-label={t("rpPeriod", { start: "", end: "" })}
          value={chosen?.index}
          onChange={(e) => setIndex(Number(e.target.value))}
        >
          {list.map((r) => (
            <option key={r.index} value={r.index}>
              {t("rpPeriod", { start: r.start_day, end: r.end_day })}
            </option>
          ))}
        </select>
      )}
      {chosen ? <Report r={chosen} /> : <EmptyState text={t("rpNone")} hint={t("v2.analysis.rp.emptyHint")} />}
      <PnSection title={t("rpCurrent")} icon="report" className="pn-ledger">
        <BalanceTable b={data.current} />
      </PnSection>
      {data.economy && data.economy.length > 0 && <EconomySection reports={data.economy} />}
    </div>
  );
}
