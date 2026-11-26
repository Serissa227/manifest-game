// 港口窗口的“仓库”页：仓库的容量（装载条、租用与自有、每天的租金与买下的价钱写在按钮旁边），以及装卸台
// （舰队、商队与仓库之间搬货，见 TransferDesk.tsx）。租用与购买照旧走 RentWarehouse / BuyWarehouse。
// 新界面（v2）：常用的装卸台排在上面，容量（租用、买下）排在下面、有自己的小标题；v1 的顺序与结构不变。
// T03：装卸台下面是“代办”一栏（AgencyDesk.tsx）。
import { useState } from "react";
import { money, t } from "../../i18n";
import type { PortView } from "../../ipc/types";
import { useGame } from "../../store/game";
import { useIsV2 } from "../../ui/uiMode";
import { ActionButton, NumInput, Section } from "../common";
import AgencyDesk from "./AgencyDesk";
import TransferDesk from "./TransferDesk";
import { LoadBar } from "./tradeKit";

export default function WarehouseTab({ port }: { port: PortView }) {
  const statics = useGame((s) => s.statics);
  const cash = useGame((s) => s.overview?.cash ?? 0);
  const submit = useGame((s) => s.submit);
  const w = port.warehouse;
  const [rent, setRent] = useState(Math.max(w.rented, 200));
  const [buy, setBuy] = useState(100);
  const v2 = useIsV2();
  if (!statics) return null;
  const perHundred = statics.rules.warehouse_rent_per_100;
  const perUnit = statics.rules.warehouse_price_per_unit;
  // 内核按“租用容量 × 每 100 单位的租金 ÷ 100”每天收租（取整）
  const dayRent = Math.floor((Math.max(0, rent) * perHundred) / 100);
  const buyCost = Math.max(0, buy) * perUnit;
  const cap = (
    <div className="wh-cap">
      <p className="wh-cap-line">
        {t("whCapacity", { used: w.used, capacity: w.capacity, rented: w.rented, owned: w.owned })}
        <LoadBar used={w.used} capacity={w.capacity} />
      </p>
      <p className="sub">
        {t("whRentPrice", { price: perHundred })} · {t("whBuyPrice", { price: perUnit })}
      </p>
      <div className="row wh-row">
        <NumInput label={t("whRent")} value={rent} min={0} step={50} onChange={(v) => setRent(Math.max(0, v))} />
        <span className="sub wh-cost" data-testid="wh-rent-cost">
          {rent > 0 ? t("wh.rentCost", { v: money(dayRent) }) : t("wh.rentNone")}
        </span>
        <ActionButton disabled={rent === w.rented} onClick={() => submit({ RentWarehouse: { owner: "player", loc: port.loc, capacity: rent } })}>
          {rent === 0 && w.rented > 0 ? t("wh.stopRent") : t("whRent")}
        </ActionButton>
      </div>
      <div className="row wh-row">
        <NumInput label={t("whBuy")} value={buy} min={1} step={50} onChange={(v) => setBuy(Math.max(0, v))} />
        <span className={buyCost > cash ? "wh-cost warn" : "sub wh-cost"} data-testid="wh-buy-cost">
          {buyCost > cash ? t("wh.buyShort", { v: money(buyCost) }) : t("wh.buyCost", { v: money(buyCost) })}
        </span>
        <ActionButton disabled={buy <= 0 || buyCost > cash} onClick={() => submit({ BuyWarehouse: { owner: "player", loc: port.loc, capacity: buy } })}>
          {t("whBuy")}
        </ActionButton>
      </div>
    </div>
  );
  const desk = (
    <>
      <Section title={t("tr.title")}>
        <TransferDesk port={port} />
      </Section>
      {/* T03 商馆代办：挂单、撤单与成交记录（规则关闭的世界没有这一栏） */}
      {w.agency && <AgencyDesk loc={port.loc} agency={w.agency} />}
    </>
  );
  // 新界面：常用的装卸台放在上面，不常动的容量（租用、买下）放在下面并有自己的小标题；v1 照旧是容量在上
  return (
    <div className="wh" data-testid="warehouse">
      {v2 ? (
        <>
          {desk}
          <Section title={t("v2.port.whCap")}>{cap}</Section>
        </>
      ) : (
        <>
          {cap}
          {desk}
        </>
      )}
    </div>
  );
}
