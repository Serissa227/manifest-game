// 舰队页的“购买补给”：粮食、淡水各一个数量加减（与交易所同一套手感：长按连发、Shift ×10、滚轮、拖动），
// 写明约花多少钱、占多少舱位、补完够几天；舱位不够时写明。成交照旧走 Resupply（由内核校验现金与舱位）。
// 够几天、补到 10 / 30 天要买多少照后端的 V01 字段（supplyKit.ts；粮水按船员人日累计，一份往往吃好几天）。
// 新界面（v2）：最上面一行“船上粮 X / 水 Y，够 N 天”；“补到 10 / 30 天 · 约 N 金币”点一下就买好（SupplyPresets.tsx），
// 已经够了写“已够 30 天”、钱或舱位不够时不可用并写明为什么；累计规则的世界最后一行说明一份够几人吃、吃到一半的那份照样占舱位。
// 旧界面（v1）照旧：“够 10 / 30 天”只把数量填进加减框，再点“购买补给”。
import { useState } from "react";
import { money, num, t } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import type { FleetView } from "../../ipc/types";
import { useGame } from "../../store/game";
import { useIsV2 } from "../../ui/uiMode";
import { ActionButton } from "../common";
import { SupplyPresets } from "./SupplyPresets";
import { SUPPLY_PRESETS, daysAfter, freeRoom, haveText, supplyCost, supplyDays, supplyTarget, type SupplyPreset } from "./supplyKit";
import { QtyStepper } from "./tradeKit";

export default function SupplyDesk({ fleet }: { fleet: FleetView }) {
  const statics = useGame((s) => s.statics);
  const cash = useGame((s) => s.overview?.cash ?? 0);
  const submit = useGame((s) => s.submit);
  const v2 = useIsV2();
  const [food, setFood] = useState(0);
  const [water, setWater] = useState(0);
  if (!statics || fleet.docked === null) return null;
  const rules = statics.rules;
  const free = freeRoom(fleet);
  const f = Math.min(food, free);
  const w = Math.min(water, Math.max(0, free - f));
  // 口粮按当地市场最便宜的粮食买，买不到时按固定价（内核 provisions_quote）；这里按固定价估算
  const cost = supplyCost(rules, { food: f, water: w });
  const after = daysAfter(fleet, rules, { food: f, water: w });
  // 旧界面：“够 N 天”把数量填进加减框（补到后端给的库存目标）
  const upTo = (n: SupplyPreset) => {
    const target = supplyTarget(fleet, n);
    const fitFood = Math.min(Math.max(0, target - fleet.food), free);
    setFood(fitFood);
    setWater(Math.min(Math.max(0, target - fleet.water), Math.max(0, free - fitFood)));
  };
  const presets = supplyDays(fleet) === null ? [] : SUPPLY_PRESETS.filter((n) => supplyTarget(fleet, n) > Math.min(fleet.food, fleet.water));
  return (
    <div className="sp-desk" data-testid="supply-desk">
      {v2 && (
        <p className="sp-have" data-testid="sp-have">
          {haveText(fleet, true)}
        </p>
      )}
      {v2 && <SupplyPresets fleet={fleet} />}
      <div className="sp-rows">
        <div className="sp-row">
          <span className="sp-label">{t("flFood")}</span>
          <QtyStepper
            value={f}
            max={Math.max(0, free - w)}
            onChange={setFood}
            label={t("sp.foodQty")}
            decLabel={t("sp.dec")}
            incLabel={t("sp.inc")}
            testId="sp-food"
          />
        </div>
        <div className="sp-row">
          <span className="sp-label">{t("flWater")}</span>
          <QtyStepper
            value={w}
            max={Math.max(0, free - f)}
            onChange={setWater}
            label={t("sp.waterQty")}
            decLabel={t("sp.dec")}
            incLabel={t("sp.inc")}
            testId="sp-water"
          />
        </div>
        {!v2 && presets.length > 0 && (
          <span className="sp-presets" role="group" aria-label={t("mk.presets")}>
            {presets.map((n) => (
              <button key={n} type="button" className="btn small" onClick={() => upTo(n)}>
                {t("sp.days", { n })}
              </button>
            ))}
          </span>
        )}
      </div>
      <p className={cost > cash ? "sp-note warn" : "sp-note sub"} data-testid="sp-note">
        {free <= 0
          ? t("sp.noRoom")
          : t("sp.cost", { v: money(cost), n: num(f + w), free: num(free) })}
        {(f > 0 || w > 0) && after !== null && ` · ${t("sp.after", { days: after })}`}
      </p>
      <ActionButton
        kind="primary"
        disabled={f + w <= 0 || cost > cash}
        onClick={async () => {
          const r = await submit({ Resupply: { owner: "player", fleet: fleet.id, food: f, water: w } });
          if (r) {
            setFood(0);
            setWater(0);
          }
        }}
      >
        {t("sp.buy", { v: money(cost) })}
      </ActionButton>
      {v2 && rules.fractional_supplies && (
        <p className="sp-help" data-testid="sp-help">
          {tz("sup.help", { per: rules.crew_per_supply_unit })}
        </p>
      )}
      {fleet.wear && <PortWear fleet={fleet} wear={fleet.wear} cash={cash} />}
    </div>
  );
}

/** H02：在港买船材、刮船底（规则关着的世界后端不给 wear，不显示）。 */
function PortWear({ fleet, wear, cash }: { fleet: FleetView; wear: NonNullable<FleetView["wear"]>; cash: number }) {
  const submit = useGame((s) => s.submit);
  const need = Math.max(0, wear.timber_cap - wear.timber);
  const timberCost = need * wear.timber_price;
  return (
    <div className="sp-wear" data-testid="sp-wear">
      <p className="sp-note sub">{tz("port.timberHint", { cap: wear.timber_cap / Math.max(1, fleet.ships.length), n: wear.timber })}</p>
      {need > 0 ? (
        <ActionButton
          disabled={timberCost > cash}
          onClick={async () => {
            await submit({ Voyage: { owner: "player", fleet: fleet.id, order: { buy_timber: { qty: need } } } });
          }}
        >
          {tz("port.timberBuy", { n: need, cost: money(timberCost) })}
        </ActionButton>
      ) : (
        <p className="sp-note sub">{tz("port.timberFull")}</p>
      )}
      <p className="sp-note sub">{wear.fouling > 0 ? tz("port.scrapeHint", { v: wear.fouling, cost: money(wear.scrape_cost) }) : tz("port.scrapeClean")}</p>
      {wear.fouling > 0 && (
        <ActionButton
          disabled={wear.scrape_cost > cash}
          onClick={async () => {
            await submit({ Voyage: { owner: "player", fleet: fleet.id, order: "scrape" } });
          }}
        >
          {tz("port.scrapeGo", { cost: money(wear.scrape_cost) })}
        </ActionButton>
      )}
    </div>
  );
}
