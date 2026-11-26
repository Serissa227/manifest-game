// 期货窗口：保证金账户（存入 / 取回）与合约行情板（报价、持仓、下单）。
// 新界面（v2，docs/UI-REDESIGN.md 第 4 节“列表行与行内操作”）：不再“先选中一行、再在下面的单子里下单”——
// 手数放在行情板上方，每一行直接“开多 / 开空 / 平仓”，交割方式也在持仓那一格里切换（“现金结算 | 实物交割”两段），交割港写进合约的小字；
// 存取保证金的金额挪到账户上方；追保的账户多一句后果与差额，还差钱时一键“存入差额”；手机上每张合约是一张卡（格子带 data-label）。
// 手机（竖屏 phone、横屏 short）上合约排在保证金账户前面，第一屏就看得到每一行的下单按钮；追保时最上面另有一条追保说明与“存入差额”
// （那时最要紧的是补保证金），账户卡里就不再重复这两样。DOM 顺序跟着换（键盘与读屏的顺序与看到的一致）。
// 行内下单防连点：一行的单子在路上时这一行的三个按钮都禁用（回音慢的时候双击会开出两倍的仓）；
// 平仓按下单那一刻现查的持仓数平（行情板上的持仓可能还是上一笔成交之前的，照旧数平会多平、甚至反向开仓）。
// 旧界面（v1）的结构与行为不变（点一行出下单单子）。
import { GoodGlyphOf } from "./GoodGlyph";
import { useRef, useState } from "react";
import { money, num, t, type StringKey } from "../../i18n";
import { api } from "../../ipc/api";
import { exchangeById, locById } from "../../ipc/byId";
import type { FuturesRow, FuturesView } from "../../ipc/types";
import { useView } from "../../hooks/useView";
import { isCompact, useLayout } from "../../hooks/useViewport";
import { useGame } from "../../store/game";
import { useIsV2 } from "../../ui/uiMode";
import { drawTrendArrow } from "../../art/extras";
import { Sprite } from "../../art/Sprite";
import { ActionButton, Empty, NumInput } from "../common";
import { EmptyState } from "../feedback";
import { Bar, Icon, PnSection } from "./PanelKit";

/** 涨跌小箭头（装饰）。 */
function Trend({ v }: { v: number }) {
  return <Sprite px={drawTrendArrow(v > 0 ? "up" : v < 0 ? "down" : "flat")} scale={2} className="pn-trend-arrow" />;
}

/**
 * v2 追保的一键补救：“存入差额 n 金币”——按差额直接存入，不用先在上面的金额框里打这个数再点“存入保证金”。
 * 存够维持保证金后差额没了、按钮随之不见（追保的小签要到明天盯市才撤）。在路上时禁用，双击只存一次。
 */
function TopUp({ exchange, short, deposit }: { exchange: string; short: number; deposit: (amount: number) => Promise<unknown> }) {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await deposit(short);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className="btn small fu-topup"
      disabled={busy}
      aria-label={t("v2.analysis.fu.topUpAria", { exchange, short })}
      onClick={() => void run()}
    >
      {t("v2.analysis.fu.topUp", { short })}
    </button>
  );
}

/** 期货：合约列表、报价、持仓、保证金水平、追保提示、到期交割选择。 */
export default function FuturesPanel() {
  const statics = useGame((s) => s.statics);
  const submit = useGame((s) => s.submit);
  const fail = useGame((s) => s.fail);
  const { data, reload } = useView("futures", () => api.futures());
  const [amount, setAmount] = useState(5000);
  const [lots, setLots] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);
  // v2 行内下单：单子还在路上的合约（ref 管拦截——同一帧里的第二下也拦得住；state 管画成禁用）
  const inflight = useRef(new Set<number>());
  const [busy, setBusy] = useState<ReadonlySet<number>>(() => new Set());
  const v2 = useIsV2();
  const layout = useLayout();
  if (!statics || !data) return null;
  /** v2 的手机布局：合约在前、追保说明与“存入差额”在最上面一条（见文件头） */
  const compact = v2 && isCompact(layout);
  const exchangeName = (ex: number) => exchangeById(statics, ex)?.name ?? "";
  const row: FuturesRow | undefined = data.contracts.find((c) => c.id === selected);
  const contractName = (c: FuturesRow) => t("fuContract", { good: statics.goods[c.good]?.name ?? "", expiry: c.expiry_day });
  /** v2：格子前的小标签（手机上一行变成一张卡时显示）；v1 不加属性 */
  const cell = (key: StringKey) => (v2 ? { "data-label": t(key) } : {});
  /** 一行下一单：在路上时这一行的按钮都禁用，第二下不再发出去。 */
  const order = async (id: number, run: () => Promise<unknown>) => {
    if (inflight.current.has(id)) return;
    inflight.current.add(id);
    setBusy(new Set(inflight.current));
    try {
      await run();
    } finally {
      inflight.current.delete(id);
      setBusy(new Set(inflight.current));
    }
  };
  const trade = (c: FuturesRow, n: number) => void order(c.id, () => submit({ TradeFutures: { owner: "player", contract: c.id, lots: n } }));
  /** 换交割方式（与下单同样走 order：在路上时这一行整体禁用）。 */
  const settle = (c: FuturesRow, physical: boolean) =>
    void order(c.id, () => submit({ SetDelivery: { owner: "player", contract: c.id, physical } }));
  /** 平仓：现查一次这张合约的持仓，按那一刻的手数反向成交；已经没有持仓了就只刷新行情板。 */
  const close = (c: FuturesRow) =>
    void order(c.id, async () => {
      let held = 0;
      try {
        held = (await api.futures()).contracts.find((x) => x.id === c.id)?.position?.lots ?? 0;
      } catch (e) {
        fail(e);
        return;
      }
      if (held === 0) {
        reload();
        return;
      }
      await submit({ TradeFutures: { owner: "player", contract: c.id, lots: -held } });
    });
  const amountField = <NumInput label={t("bkAmount")} value={amount} min={1} onChange={setAmount} />;
  /** v2 追保：后果与差额一句话，还差钱时下面一键“存入差额”（桌面在账户卡里，手机在最上面那一条里）。 */
  const callFix = (a: FuturesView["accounts"][number]) => (
    <>
      <p className="fu-call-note" data-testid={`fu-call-note-${a.exchange}`}>
        {t("v2.analysis.fu.callRisk")}
        {a.balance < a.maintenance_requirement && t("v2.analysis.fu.callShort", { short: a.maintenance_requirement - a.balance })}
      </p>
      {a.balance < a.maintenance_requirement && (
        <div className="fu-call-fix">
          <TopUp
            exchange={exchangeName(a.exchange)}
            short={a.maintenance_requirement - a.balance}
            deposit={(n) => submit({ DepositMargin: { owner: "player", exchange: a.exchange, amount: n } })}
          />
        </div>
      )}
    </>
  );
  const accountsSection = (
    <PnSection title={t("fuAccounts")} icon="bank">
      {v2 && (
        <div className="fu-toolbar" data-testid="fu-amount">
          {amountField}
          <small className="fu-toolbar-hint">{t("v2.analysis.fu.amountHint")}</small>
        </div>
      )}
      <div className="pn-accounts">
        {data.accounts.map((a) => (
          <article key={a.exchange} className={a.call_since !== null ? "pn-card pn-account pn-call" : "pn-card pn-account"}>
            <header className="pn-account-head">
              <Icon name="exchange" />
              <strong>{exchangeById(statics, a.exchange)?.name}</strong>
              {a.call_since !== null && (
                <strong className="warn pn-call-flag" role="alert">
                  {t("fuCall", { since: a.call_since })}
                </strong>
              )}
            </header>
            {v2 && !compact && a.call_since !== null && callFix(a)}
            <dl className="pn-account-kv">
              <div>
                <dt>{t("fuBalance")}</dt>
                <dd>{money(a.balance)}</dd>
              </div>
              <div>
                <dt>{t("fuInitial")}</dt>
                <dd>{money(a.initial_requirement)}</dd>
              </div>
              <div>
                <dt>{t("fuMaintenance")}</dt>
                <dd>{money(a.maintenance_requirement)}</dd>
              </div>
            </dl>
            {/* 保证金水位：满格为初始保证金要求的两倍，红线是维持保证金 */}
            <Bar
              value={a.balance}
              max={Math.max(a.initial_requirement * 2, a.balance, 1)}
              mark={a.maintenance_requirement}
              tone={a.balance >= a.initial_requirement ? "trade" : "combat"}
            />
            <div className="row">
              <ActionButton
                onClick={() => submit({ DepositMargin: { owner: "player", exchange: a.exchange, amount } })}
              >
                {t("fuDeposit")}
              </ActionButton>
              <ActionButton
                onClick={() => submit({ WithdrawMargin: { owner: "player", exchange: a.exchange, amount } })}
              >
                {t("fuWithdraw")}
              </ActionButton>
            </div>
          </article>
        ))}
      </div>
      {!v2 && amountField}
    </PnSection>
  );
  const boardSection = (
    <PnSection title={t("fuContracts")} icon="futures" className="pn-board-section">
      {data.contracts.length === 0 ? (
        <EmptyState text={t("v2.analysis.fu.empty")} hint={t("v2.analysis.fu.emptyHint")} v1={<Empty text={t("none")} />} />
      ) : (
        <>
          {v2 && (
            <div className="fu-toolbar" data-testid="fu-lots">
              <NumInput label={t("fuLots")} value={lots} min={1} onChange={setLots} />
              <small className="fu-toolbar-hint">{t("v2.analysis.fu.lotsHint")}</small>
            </div>
          )}
          <div className="pn-board">
            <div className="pn-board-title">{t("pnBoardTitle")}</div>
          <table className="grid pn-quotes">
            <thead>
              <tr>
                <th>{t("fuContracts")}</th>
                <th>{t("fuBid")}</th>
                <th>{t("fuAsk")}</th>
                <th>{t("fuMark")}</th>
                <th>{t("fuSpot")}</th>
                <th>{t("fuPosition")}</th>
                {v2 && <th className="fu-act-head">{t("v2.analysis.fu.actions")}</th>}
              </tr>
            </thead>
            <tbody>
              {data.contracts.map((c) => (
                <tr
                  key={c.id}
                  className={!v2 && c.id === selected ? "selected" : ""}
                  onClick={v2 ? undefined : () => setSelected(c.id)}
                  data-testid={`futures-row-${c.id}`}
                >
                  <td className="pn-quote-name">
                    <GoodGlyphOf statics={statics} good={c.good} scale={1} className="pn-good-icon" />
                    <span className="pn-quote-text">
                      <b>{contractName(c)}</b>
                      <small>
                        {exchangeById(statics, c.exchange)?.name} · {t("fuLot", { lot: c.lot })} ·{" "}
                        {t("fuDaysLeft", { days: c.days_left })}
                        {v2 && ` · ${t("v2.analysis.fu.delivery", { port: locById(statics, c.delivery)?.name ?? "" })}`}
                      </small>
                    </span>
                  </td>
                  <td className="num pn-bid" {...cell("fuBid")}>
                    {c.bid}
                  </td>
                  <td className="num pn-ask" {...cell("fuAsk")}>
                    {c.ask}
                  </td>
                  <td className="num pn-mark" {...cell("fuMark")}>
                    {c.mark}
                  </td>
                  <td className="num" {...cell("fuSpot")}>
                    {c.spot}
                  </td>
                  <td className={c.position ? (c.position.pnl >= 0 ? "pn-pos up" : "pn-pos down") : "pn-pos"} {...cell("fuPosition")}>
                    {c.position && <Trend v={c.position.pnl} />}
                    {c.position
                      ? t("fuPositionLine", {
                          lots: c.position.lots,
                          avg: c.position.avg_price,
                          pnl: num(c.position.pnl),
                        })
                      : t("fuNoPosition")}
                    {v2 && c.position && (
                      // 交割方式：两段的切换（现金结算 | 实物交割），选中的那段高亮；字不随状态变（复选框写“现在是什么”会读反）。
                      // 这一组的名字带合约名（读屏进来先念“丝绸 · 第 60 天到期：到期交割方式”，每一行听得出是哪张合约）
                      <fieldset
                        className="fu-settle"
                        aria-label={t("v2.analysis.fu.settleAria", { contract: contractName(c) })}
                        disabled={busy.has(c.id)}
                      >
                        <span className="fu-settle-label" aria-hidden="true">
                          {t("v2.analysis.fu.settle")}
                        </span>
                        <label>
                          <input
                            type="radio"
                            name={`fu-settle-${c.id}`}
                            checked={!c.position.physical}
                            onChange={() => settle(c, false)}
                          />
                          {t("v2.analysis.fu.cash")}
                        </label>
                        <label>
                          <input
                            type="radio"
                            name={`fu-settle-${c.id}`}
                            checked={c.position.physical}
                            onChange={() => settle(c, true)}
                          />
                          {t("v2.analysis.fu.physical")}
                        </label>
                      </fieldset>
                    )}
                  </td>
                  {v2 && (
                    <td className="fu-act">
                      <button
                        type="button"
                        className="btn small fu-long"
                        disabled={busy.has(c.id)}
                        aria-label={t("v2.analysis.fu.longAria", { contract: contractName(c), n: lots })}
                        onClick={() => trade(c, lots)}
                      >
                        {t("v2.analysis.fu.long", { n: lots })}
                      </button>
                      <button
                        type="button"
                        className="btn small fu-short"
                        disabled={busy.has(c.id)}
                        aria-label={t("v2.analysis.fu.shortAria", { contract: contractName(c), n: lots })}
                        onClick={() => trade(c, -lots)}
                      >
                        {t("v2.analysis.fu.short", { n: lots })}
                      </button>
                      {c.position && (
                        <button
                          type="button"
                          className="btn small fu-close"
                          disabled={busy.has(c.id)}
                          aria-label={t("v2.analysis.fu.closeAria", { contract: contractName(c), n: Math.abs(c.position.lots) })}
                          onClick={() => close(c)}
                        >
                          {t("v2.analysis.fu.close")}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </PnSection>
  );
  return (
    <div data-testid="futures-panel" className="pn pn-futures">
      {compact ? (
        <>
          {data.accounts
            .filter((a) => a.call_since !== null)
            .map((a) => (
              <div key={a.exchange} className="fu-call-strip" data-testid={`fu-call-strip-${a.exchange}`}>
                <p className="fu-call-strip-head">
                  <Icon name="exchange" />
                  <strong>{exchangeName(a.exchange)}</strong>
                  <span className="fu-call-flag">{t("fuCall", { since: a.call_since ?? 0 })}</span>
                </p>
                {callFix(a)}
              </div>
            ))}
          {boardSection}
          {accountsSection}
        </>
      ) : (
        <>
          {accountsSection}
          {boardSection}
        </>
      )}
      {row && !v2 && (
        <PnSection
          title={t("fuContract", { good: statics.goods[row.good]?.name ?? "", expiry: row.expiry_day })}
          icon="futures"
          className="pn-ticket"
        >
          <p className="pn-delivery">
            <Icon name="anchor" />
            {t("labelValue", { label: t("fuDelivery"), value: locById(statics, row.delivery)?.name ?? "" })}
          </p>
          <NumInput label={t("fuLots")} value={lots} min={1} onChange={setLots} />
          <div className="row">
            <ActionButton
              kind="primary"
              onClick={() => submit({ TradeFutures: { owner: "player", contract: row.id, lots } })}
            >
              {t("fuLong")}
            </ActionButton>
            <ActionButton onClick={() => submit({ TradeFutures: { owner: "player", contract: row.id, lots: -lots } })}>
              {t("fuShort")}
            </ActionButton>
            {row.position && (
              <ActionButton
                onClick={() =>
                  submit({ TradeFutures: { owner: "player", contract: row.id, lots: -(row.position?.lots ?? 0) } })
                }
              >
                {t("fuClose")}
              </ActionButton>
            )}
          </div>
          {row.position && (
            <label className="field">
              <input
                type="checkbox"
                checked={row.position.physical}
                onChange={(e) =>
                  void submit({ SetDelivery: { owner: "player", contract: row.id, physical: e.target.checked } })
                }
              />
              <span>{row.position.physical ? t("fuPhysical") : t("fuCash")}</span>
            </label>
          )}
        </PnSection>
      )}
    </div>
  );
}
