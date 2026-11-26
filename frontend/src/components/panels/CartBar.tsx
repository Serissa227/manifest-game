// 交易所底部的账台（贴在窗口底部，长列表滚到哪里都看得见）：现金与装载（数字滚动变化、装载条），
// 成交单不空时写出卖出、买入的合计与盈亏、成交后的现金与装载，现金不够时写明差多少并可一键减到买得起，“成交”一次结清。
// 新界面（v2）：成交单空着时右边的键盘提示画成小键帽（KeyHints，触屏上不显示）；v1 照旧是一行字。
import { money, num, t } from "../../i18n";
import { KeyHints, type KeyHint } from "../feedback";
import { slot, slotted } from "./tradeHooks";
import { LoadBar, RollingNumber } from "./tradeKit";
import type { CartSummary, Load } from "./trade";

export interface CartBarProps {
  cash: number;
  load: Load;
  /** 成交单的合计；成交单是空的时为 null */
  summary: CartSummary | null;
  lines: number;
  busy: boolean;
  onSettle: () => void;
  onClear: () => void;
  onFitCash: () => void;
}

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${num(Math.abs(Math.round(v)))}`;

/** 交易台的键盘操作（与 Market.tsx 的按键处理一致）：↑↓ 选货、←→ 调数量、Shift 一次 10 件、回车成交、空格看明细。 */
const keyHints = (): KeyHint[] => [
  { keys: ["ArrowUp", "ArrowDown"], label: t("v2.port.keyPick") },
  { keys: ["ArrowLeft", "ArrowRight"], label: t("v2.port.keyQty") },
  { keys: ["Shift"], label: t("v2.port.keyTen") },
  { keys: ["Enter"], label: t("v2.port.keySettle") },
  { keys: ["Space"], label: t("v2.port.keyDetail") },
];

export default function CartBar({ cash, load, summary, lines, busy, onSettle, onClear, onFitCash }: CartBarProps) {
  const s = summary;
  const about = s && !s.exact ? `${t("mk.about")} ` : "";
  const cashAfter = s && s.cashAfter !== cash ? s.cashAfter : null;
  const usedAfter = s && s.usedAfter !== load.used ? s.usedAfter : null;
  const blocked = !!s && (s.shortCash > 0 || s.overSpace > 0);
  return (
    <div className={s ? "mk-cart open" : "mk-cart"} role="group" aria-label={t("mk.cart")} data-testid="mk-cart">
      <div className="mk-cart-status">
        <span className="mk-load" data-testid="mk-load">
          <span className="mk-load-part">
            {slotted(t("mk.cash", { cash: slot("cash") }), {
              cash: (
                <>
                  <RollingNumber value={cash} format={money} className="mk-cash-n" />
                  {cashAfter !== null && <span className={cashAfter < 0 ? "mk-after bad" : "mk-after"}> → {money(cashAfter)}</span>}
                </>
              ),
            })}
          </span>
          <span className="mk-dot"> · </span>
          <span className="mk-load-part">
            {slotted(t("mk.load", { used: slot("used"), capacity: slot("capacity") }), {
              used: (
                <>
                  <RollingNumber value={load.used} format={num} className="mk-used-n" />
                  {usedAfter !== null && <span className={usedAfter > load.capacity ? "mk-after bad" : "mk-after"}> → {num(usedAfter)}</span>}
                </>
              ),
              capacity: num(load.capacity),
            })}
          </span>
        </span>
        <LoadBar used={load.used} capacity={load.capacity} after={s?.usedAfter} />
      </div>
      {s ? (
        <>
          <div className="mk-cart-sum" data-testid="mk-cart-sum">
            {s.sells > 0 && (
              <span className="mk-sum-part">
                {t("mk.cartSell", { n: s.sells })} <b className="mk-gain">{about}+{num(s.sellTotal)}</b>
              </span>
            )}
            {s.buys > 0 && (
              <span className="mk-sum-part">
                {t("mk.cartBuy", { n: s.buys })} <b className="mk-loss">{about}−{num(s.buyTotal)}</b>
              </span>
            )}
            {s.sells > 0 && (
              <span className="mk-sum-part">
                {t("mk.profit")} <b className={s.profit >= 0 ? "mk-gain" : "mk-loss"}>{signed(s.profit)}</b>
              </span>
            )}
          </div>
          {blocked && (
            <div className="mk-cart-warn" role="alert" data-testid="mk-cart-warn">
              {s.shortCash > 0 && (
                <>
                  <span>{t("mk.shortCash", { v: money(s.shortCash) })}</span>
                  <button type="button" className="btn small" disabled={busy} onClick={onFitCash}>
                    {t("mk.fitCash")}
                  </button>
                </>
              )}
              {s.overSpace > 0 && <span>{t("mk.overSpace", { n: num(s.overSpace) })}</span>}
            </div>
          )}
          <div className="mk-cart-actions">
            <button type="button" className="btn mk-clear" disabled={busy} onClick={onClear}>
              {t("mk.clear")}
            </button>
            <button
              type="button"
              className="btn primary mk-settle"
              disabled={busy || blocked}
              title={t("mk.settleHint")}
              onClick={onSettle}
              data-testid="mk-settle"
            >
              {busy ? t("mk.settling") : t("mk.settle", { n: lines })}
            </button>
          </div>
        </>
      ) : (
        <KeyHints on="night" className="mk-keys" items={keyHints()} v1={<span className="mk-keys sub">{t("mk.keys")}</span>} />
      )}
    </div>
  );
}
