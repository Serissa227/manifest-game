// 港口窗口的“船厂”页：出售的船（买入编入舰队 / 组建新舰队；钱不够时按钮灰掉并写明差多少），在港舰队的修理、卖船与改造。
// 与原来相比（交易操作现代化）：卖船要确认一次（卖船不能反悔，原来一点就卖）；卖不了的船写明原因（只剩一艘、独有船型、
// 卖了装不下货或船员太多）；改造在每艘船自己的一行里选（原来是船单下面一个公用的下拉框），已经做过的改造不再列出；
// 没有船厂的港口不给卖船、改造的按钮（内核也会拒绝）。命令照旧：BuyShip / FoundFleet / Repair / SellShip / RefitShip。
// 新界面（v2）：没有造船厂时空状态写明最近的造船厂在哪，一键“看看那里的造船厂”（v1 照旧只有一句）。
// T02：船厂随港口发展度造更大的船；在售清单由后端按发展度给出，下面另列“还没开造”的船型与差多少发展度，一键去投资。
import { useEffect, useState } from "react";
import { money, nameOf, t } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import { locById } from "../../ipc/byId";
import type { FleetView, LocView, PortView, StaticView } from "../../ipc/types";
import { useGame, useOverviewFields } from "../../store/game";
import { ActionButton, Section, Select } from "../common";
import { EmptyState } from "../feedback";
import { saleShips } from "./shipSale";
import { LegendShipTag } from "./LegendShipTag";
import { ShipOffer } from "../port/cards";
import { stageName, stageOf } from "../port/devScale";
import { sellShipBlock } from "./trade";

/** 离 loc 最近的有造船厂的港口（直线距离；没有时为 null）。 */
function nearestShipyard(statics: StaticView, loc: number): LocView | null {
  const here = locById(statics, loc);
  if (!here) return null;
  let best: LocView | null = null;
  let bestD = Infinity;
  for (const l of statics.locations) {
    if (l.id === loc || !l.shipyard || l.kind !== "port") continue;
    const d = (l.x - here.x) ** 2 + (l.y - here.y) ** 2;
    if (d < bestD) {
      best = l;
      bestD = d;
    }
  }
  return best;
}

function FleetYard({ fleet, statics, shipyard }: { fleet: FleetView; statics: StaticView; shipyard: boolean }) {
  const cash = useGame((s) => s.overview?.cash ?? 0);
  const submit = useGame((s) => s.submit);
  // 等着确认卖掉的船（第几艘）；过几秒没确认就收回
  const [confirm, setConfirm] = useState<number | null>(null);
  const [refits, setRefits] = useState<Record<number, number>>({});
  useEffect(() => {
    if (confirm === null) return;
    const id = window.setTimeout(() => setConfirm(null), 5000);
    return () => window.clearTimeout(id);
  }, [confirm]);
  return (
    <Section title={t("holder.fleet", { id: fleet.id })} testId={`yard-fleet-${fleet.id}`}>
      <ActionButton disabled={fleet.repair_cost <= 0 || fleet.repair_cost > cash} onClick={() => submit({ Repair: { owner: "player", fleet: fleet.id } })}>
        {t("syRepair", { cost: fleet.repair_cost })}
      </ActionButton>
      <ul className="ships sy-ships">
        {fleet.ships.map((s, i) => {
          const type = statics.ships[s.kind];
          const block = sellShipBlock(statics, fleet, i);
          const open = statics.refits.filter((r) => !s.refits.includes(r.id));
          // R10-FIX8：后端逐船给每种改装此刻能不能做（refit_options，判断与真改装同一处）；做不了的灰着带原因，缺省选第一项做得了的
          const optOf = (id: number) => s.refit_options?.find((o) => o.id === id);
          const refitWhy = (id: number) => {
            const o = optOf(id);
            return o && !o.enabled ? o.reason || tz("sy.refitNo") : null;
          };
          const pick = refits[i] ?? open.find((r) => !refitWhy(r.id))?.id ?? open[0]?.id;
          const refit = statics.refits.find((r) => r.id === pick);
          const refitNo = refit ? refitWhy(refit.id) : null;
          return (
            <li key={i} className="sy-ship" data-testid={`yard-ship-${fleet.id}-${i}`}>
              <span className="sy-ship-name">
                {/* 传说之船写它的名字与船型、带“传说之船”标签；卖船照旧按船在舰队里的下标 */}
                <strong>{s.legend?.name ?? s.name ?? nameOf(type)}</strong>
                {s.legend && (
                  <>
                    <LegendShipTag /> {nameOf(type)}
                  </>
                )}{" "}
                · {t("syDurability")} {s.durability}/{s.max_durability} · {t("syCapacity")} {s.capacity}
              </span>
              {shipyard && (
                <span className="sy-ship-acts">
                  {confirm === i ? (
                    <>
                      <button
                        type="button"
                        className="btn danger"
                        onClick={async () => {
                          setConfirm(null);
                          await submit({ SellShip: { owner: "player", fleet: fleet.id, ship: i } });
                        }}
                      >
                        {t("sy.sellConfirm", { v: money(s.resale) })}
                      </button>
                      <button type="button" className="btn" onClick={() => setConfirm(null)}>
                        {t("cancel")}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn" disabled={!!block} title={block ?? undefined} onClick={() => setConfirm(i)}>
                      {t("sySell")} {money(s.resale)}
                    </button>
                  )}
                  {block && <small className="sy-why">{block}</small>}
                  {open.length > 0 && refit && (
                    <span className="sy-refit">
                      <Select
                        label={t("syRefit")}
                        value={refit.id}
                        options={open.map((r) => ({
                          value: r.id,
                          label: t("paren", { text: nameOf(r), note: money(r.price) }),
                          disabled: !!refitWhy(r.id),
                          title: refitWhy(r.id) ?? undefined,
                        }))}
                        onChange={(v) => setRefits((m) => ({ ...m, [i]: v }))}
                      />
                      <ActionButton
                        disabled={!!refitNo || refit.price > cash}
                        title={refitNo ?? (refit.price > cash ? t("sy.short", { v: money(refit.price - cash) }) : undefined)}
                        onClick={() => submit({ RefitShip: { owner: "player", fleet: fleet.id, ship: i, refit: refit.id } })}
                      >
                        {t("syRefit")}
                      </ActionButton>
                      {refitNo && (
                        <small className="sy-why" data-testid={`yard-refit-why-${fleet.id}-${i}`}>
                          {refitNo}
                        </small>
                      )}
                    </span>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export default function ShipyardTab({ port }: { port: PortView }) {
  const statics = useGame((s) => s.statics);
  // 按字段选取（P14a）：只取用到的顶层字段，没变就不重渲染
  const overview = useOverviewFields("fleets", "cash");
  const submit = useGame((s) => s.submit);
  if (!statics || !overview) return null;
  const here = overview.fleets.filter((f) => port.fleets_here.includes(f.id));
  const fleet = here[0];
  // 独有船型不出售：后端也会过滤，这里再保险一次
  const offers = saleShips(statics, port.shipyard);
  const cash = overview.cash;
  const near = offers.length === 0 ? nearestShipyard(statics, port.loc) : null;
  const goNear = (l: LocView) => {
    const g = useGame.getState();
    g.selectLoc(l.id);
    g.setFacility("shipyard");
  };
  return (
    <div className="shipyard">
      {offers.length === 0 ? (
        <EmptyState
          text={t("syNoShipyard")}
          hint={near ? t("v2.port.syNoneHint", { port: near.name }) : undefined}
          action={near ? { label: t("v2.port.syNoneGo", { port: near.name }), onClick: () => goNear(near) } : undefined}
        />
      ) : (
        <div className="ship-offers">
          {offers.map((id) => {
            const s = statics.ships[id];
            if (!s) return null;
            const short = s.price > cash;
            return (
              <ShipOffer key={id} ship={s} statics={statics}>
                {fleet && (
                  <ActionButton disabled={short} onClick={() => submit({ BuyShip: { owner: "player", fleet: fleet.id, ship_type: id, new_fleet: false } })}>
                    {t("syBuyJoin", { id: fleet.id })}
                  </ActionButton>
                )}
                <ActionButton
                  kind="primary"
                  disabled={short}
                  onClick={() =>
                    fleet
                      ? submit({ BuyShip: { owner: "player", fleet: fleet.id, ship_type: id, new_fleet: true } })
                      : submit({ FoundFleet: { owner: "player", at: port.loc, ship_type: id } })
                  }
                >
                  {t("syBuyNew")}
                </ActionButton>
                {short && <small className="warn sy-short">{t("sy.short", { v: money(s.price - cash) })}</small>}
              </ShipOffer>
            );
          })}
        </div>
      )}
      <ShipsSoon port={port} statics={statics} />
      {here.map((f) => (
        <FleetYard key={f.id} fleet={f} statics={statics} shipyard={port.shipyard.length > 0} />
      ))}
    </div>
  );
}

/** T02：船厂还没开造、港口发展度到了才开造的船型，旁边一键去投资（推高发展度）。旧后端与规则关闭的世界没有这一栏。 */
function ShipsSoon({ port, statics }: { port: PortView; statics: StaticView }) {
  const soon = port.shipyard_upcoming ?? [];
  if (soon.length === 0) return null;
  const now = port.invest.development;
  // E02：新尺度下台阶带上阶段名（100 是港镇、400 落在商埠）；旧后端照旧只写数字
  const growth = port.invest.growth;
  return (
    <section className="sy-soon" data-testid="sy-soon">
      <h4>{tz("sy.soon.title")}</h4>
      <ul className="sy-soon-list">
        {soon.map((s) => {
          const ship = statics.ships[s.ship];
          return (
            <li key={s.ship} data-testid={`sy-soon-${s.ship}`}>
              <strong>{ship ? nameOf(ship) : `#${s.ship}`}</strong>
              {ship && <span className="sub">{t("paren", { text: money(ship.price), note: t("syCapacity") + " " + ship.capacity })}</span>}
              <span>
                {growth
                  ? tz("sy.soon.lineStage", { dev: s.development, stage: stageName(stageOf(s.development)), now })
                  : tz("sy.soon.line", { dev: s.development, now })}
              </span>
              <button type="button" className="btn small" title={tz("sy.soon.goHint")} onClick={() => useGame.getState().setFacility("invest")}>
                {tz("sy.soon.go")}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
