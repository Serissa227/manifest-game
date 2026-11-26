// 殖民地详情：标题旁的殖民地总管 → 状态牌（人口、士气、存粮、防御、税收）→ 警示 → 人口与住房、士气构成、粮食、防御与袭击
// → 事件影响（正在作用于此地的组合事件效果与剩余天数、人口增长系数）
// → 建筑卡片 → 在建工程 → 建造与升级 → 税率 → 库存与装卸 → 上月统计 → 放弃殖民地。
// 街景里点了某座建筑时（colonyUi.focus）滚动到那张建筑卡片并描金边。
// 新界面（v2）：放弃殖民地改用共用的确认对话框（主按钮写清“放弃新晨港”，手机上从底部升起）；旧界面照旧是就地的二次确认。
import { useEffect, useRef, useState } from "react";
import { money, t, tk } from "../../i18n";
import { locById } from "../../ipc/byId";
import type { BuildOptionView, ColonyBuildingView, ColonyView, StaticView } from "../../ipc/types";
import { useGame } from "../../store/game";
import { useIsV2 } from "../../ui/uiMode";
import { BiName } from "../BiName";
import { ActionButton } from "../common";
import { EmptyState, useConfirm } from "../feedback";
import { effectText as eventText } from "../panels/effectText";
import { Icon, PnSection } from "../panels/PanelKit";
import { CastBadge } from "../portrait/CastBadge";
import { stewardOf } from "../portrait/castPeople";
import { COLONY_LOW_FOOD_DAYS } from "../shell/shellState";
import { BuildingIcon, GoodChip, Meter, Tile } from "./bits";
import { CargoTransfer } from "./CargoTransfer";
import { useColonyUi } from "./colonyUi";
import { buildingDef, moraleFactors, perDay, raidMonthlyBp, raidRisk, signed, taxLevels } from "./model";

/** 存粮条的满格天数。 */
const FOOD_FULL_DAYS = 60;
/** 士气达到多少人口才会增长。 */
const MORALE_GROWTH = 50;

export function ColonyDetail({ colony }: { colony: ColonyView }) {
  const statics = useGame((s) => s.statics);
  const today = useGame((s) => s.overview?.day ?? 0);
  const focus = useColonyUi((s) => s.focus);
  const root = useRef<HTMLElement>(null);

  // 街景点了建筑或仓库：滚动到对应的卡片 / 分节
  useEffect(() => {
    if (!focus || !root.current) return;
    const sel = "building" in focus ? `[data-building="${focus.building}"]` : `[data-section="${focus.section}"]`;
    const el = root.current.querySelector<HTMLElement>(sel);
    el?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [focus, colony.id]);

  if (!statics) return null;
  const l = locById(statics, colony.loc);
  const terrain = l?.site?.terrain;
  const risk = raidRisk(colony.raid_bp);
  const starving = colony.starving_days > 0;
  const lowFood = !starving && colony.food_days < COLONY_LOW_FOOD_DAYS;
  const focusBuilding = focus && "building" in focus ? focus.building : null;
  const steward = stewardOf(colony.id);

  return (
    <article className="colony-detail" ref={root} data-testid={`colony-detail-${colony.id}`} aria-label={colony.name}>
      <header className="colony-detail-head">
        {/* 殖民地名：双行名字（玩家起的名字通常没有英文，只显示一行） */}
        <BiName as="h3" className="colony-name" zh={colony.name} en={colony.name_en} />
        <p className="sub">
          {t("colony.founded", {
            day: colony.founded,
            site: l?.name ?? "",
            terrain: terrain ? tk(`terrain.${terrain}`) : "",
          })}{" "}
          · {t("colony.bookValue", { v: colony.book_value })}
        </p>
        {/* 殖民地总管（按殖民地编号；纯装饰的头像 + 名字） */}
        <CastBadge asset={steward.asset} fallback={steward.fallback} name={steward.name} title={steward.title} testId="colony-steward" className="colony-steward" />
      </header>

      <div className="colony-tiles">
        <Tile
          icon="population"
          label={t("colony.tilePop")}
          value={`${colony.population} / ${colony.housing}`}
          tone={colony.population >= colony.housing ? "warn" : "ok"}
        >
          <Meter value={colony.population} max={colony.housing} tone="pop" />
        </Tile>
        <Tile icon="morale" label={t("colony.tileMorale")} value={colony.morale} tone={colony.morale >= MORALE_GROWTH ? "ok" : "warn"}>
          <Meter value={colony.morale} max={100} tone="morale" mark={MORALE_GROWTH} />
        </Tile>
        <Tile
          icon="food"
          label={t("colony.tileFood")}
          value={t("colony.tileDays", { n: Math.max(0, colony.food_days) })}
          tone={starving ? "bad" : lowFood ? "warn" : "ok"}
          testId="colony-food"
        >
          <Meter value={colony.food_days} max={FOOD_FULL_DAYS} tone="food" warn={starving || lowFood} />
        </Tile>
        <Tile icon="cannon" label={t("colony.tileDefense")} value={t("colony.tilePct", { n: colony.defense })} tone={risk === "high" ? "bad" : risk === "mid" ? "warn" : "ok"}>
          <Meter value={colony.defense} max={100} tone="defense" />
        </Tile>
        <Tile icon="coin" label={t("colony.tileTax")} value={money(colony.tax_estimate)}>
          <small>{tk(`colonyTax.${colony.tax}`)}</small>
        </Tile>
      </div>

      {starving && (
        <p className="colony-alert bad" role="alert">
          {t("colony.foodStarving", { days: colony.starving_days })}
        </p>
      )}
      {lowFood && <p className="colony-alert warn">{t("colony.foodLow", { days: Math.max(0, colony.food_days) })}</p>}

      <div className="colony-grid2">
        <PnSection title={t("colony.secPeople")} icon="population">
          <p className="colony-line">{t("colony.population", { n: colony.population, max: colony.housing })}</p>
          <Meter value={colony.population} max={colony.housing} tone="pop" />
          {colony.population >= colony.housing && <p className="colony-note warn">{t("colony.housingFull")}</p>}
          <p className="colony-line">
            {t("colony.workers", { need: colony.workers_needed, pct: Math.round(colony.staffing_bp / 100) })}
          </p>
          <Meter value={colony.staffing_bp} max={10000} tone="pop" warn={colony.staffing_bp < 10000} />
          {colony.staffing_bp < 10000 && (
            <p className="colony-note warn">{t("colony.workersShort", { pct: Math.round(colony.staffing_bp / 100) })}</p>
          )}
          {colony.growth_mult_bp !== undefined && colony.growth_mult_bp !== 10000 && (
            <p className={colony.growth_mult_bp > 10000 ? "colony-note up" : "colony-note warn"}>
              {t("colony.growthNote", { mult: multText(colony.growth_mult_bp) })}
            </p>
          )}
        </PnSection>

        <PnSection title={t("colony.secMorale")} icon="morale">
          <p className="colony-line">{t("colony.morale", { n: colony.morale })}</p>
          <Meter value={colony.morale} max={100} tone="morale" mark={MORALE_GROWTH} />
          <ul className="colony-factors">
            {moraleFactors(statics, colony, today).map((f) => (
              <li key={f.key} className={`colony-factor is-${f.dir}`} title={f.hint}>
                <span>{f.label}</span>
                <b>{f.delta !== null ? signed(f.delta) : f.dir === "up" ? t("colony.factorUp") : f.dir === "down" ? t("colony.factorDown") : "·"}</b>
              </li>
            ))}
          </ul>
          <p className="colony-note">{t("colony.moraleMult", { mult: (colony.morale_mult_bp / 10000).toFixed(2) })}</p>
          <p className="colony-note">{t("colony.moraleHint")}</p>
        </PnSection>

        <PnSection title={t("colony.secFood")} icon="food">
          <p className="colony-line">{t("colony.foodStock", { stock: colony.food_stock, need: colony.food_need })}</p>
          <p className="colony-line">{t("colony.foodDays", { days: Math.max(0, colony.food_days) })}</p>
          <Meter value={colony.food_days} max={FOOD_FULL_DAYS} tone="food" warn={starving || lowFood} />
        </PnSection>

        <PnSection title={t("colony.secDefense")} icon="cannon">
          <p className="colony-line">
            {t("colony.defense", { n: colony.defense })}
            <em className={`colony-risk is-${risk}`}>{tk(`colony.raid.${risk}`)}</em>
          </p>
          <Meter value={colony.defense} max={100} tone="defense" />
          <p className="colony-line">
            {t("colony.raidDaily", { pct: (colony.raid_bp / 100).toFixed(2) })} ·{" "}
            {t("colony.raidMonthly", { pct: (raidMonthlyBp(colony.raid_bp) / 100).toFixed(1) })}
          </p>
          <p className="colony-note">
            {colony.last_raid !== null ? t("colony.lastRaid", { day: colony.last_raid }) : t("colony.neverRaided")} ·{" "}
            {t("colony.raids", { n: colony.last_month.raids })}
          </p>
          <p className="colony-note">{t("colony.defenseHint")}</p>
        </PnSection>
      </div>

      {(colony.effects !== undefined || colony.growth_mult_bp !== undefined) && (
        <PnSection title={t("colony.secEffects")} icon="ai_event" testId="colony-effects">
          <Effects colony={colony} today={today} />
        </PnSection>
      )}

      <PnSection title={t("colony.secBuildings")} icon="colony" testId="colony-buildings">
        {colony.buildings.length === 0 ? (
          <EmptyState className="is-compact" text={t("colony.noBuildings")} hint={t("v2.business.col.noBuildingsHint")} />
        ) : (
          <ul className="colony-cards">
            {colony.buildings.map(([b, level]) => (
              <BuildingCard key={b} statics={statics} colony={colony} building={b} level={level} focused={focusBuilding === b} />
            ))}
          </ul>
        )}
      </PnSection>

      <PnSection title={t("colony.secConstruction")} icon="build">
        <Construction statics={statics} colony={colony} today={today} />
      </PnSection>

      <PnSection title={t("colony.secBuild")} icon="build" testId="colony-options">
        {colony.build_options.length === 0 ? (
          <EmptyState className="is-compact" text={t("colony.maxed")} />
        ) : (
          <ul className="colony-cards">
            {colony.build_options.map((o) => (
              <OptionCard key={o.building} statics={statics} colony={colony} option={o} />
            ))}
          </ul>
        )}
      </PnSection>

      <PnSection title={t("colony.secTax")} icon="coin">
        <TaxPicker statics={statics} colony={colony} />
      </PnSection>

      <div data-section="cargo">
        <PnSection title={t("colony.secCargo")} icon="cargo" testId="colony-cargo-section">
          {colony.fleets_here.length > 0 ? (
            <CargoTransfer colony={colony} />
          ) : (
            <>
              <StockList statics={statics} colony={colony} />
              <p className="colony-note">{t("colony.cargoNoFleet")}</p>
            </>
          )}
        </PnSection>
      </div>

      <PnSection title={t("colony.secMonth")} icon="report">
        <MonthStats statics={statics} colony={colony} />
      </PnSection>

      <PnSection title={t("colony.secAbandon")} icon="close">
        <Abandon colony={colony} />
      </PnSection>
    </article>
  );
}

/** 系数（万分之一）→ “1.30” 这样的两位小数。 */
function multText(bp: number): string {
  return (bp / 10000).toFixed(2);
}

/**
 * 事件影响：人口增长与移民系数（10000 表示不受影响），以及正在作用于此地的组合事件效果——
 * 每条写效果名、“建筑 · 方向与幅度 · 持续”（省略殖民地本身）与剩余天数（结束日不含）。
 */
function Effects({ colony, today }: { colony: ColonyView; today: number }) {
  const effects = colony.effects ?? [];
  const growth = colony.growth_mult_bp ?? 10000;
  return (
    <>
      <p className="colony-line" title={t("colony.growthHint")}>
        <Icon name="population" />
        <span>{t("colony.growthMult", { mult: multText(growth) })}</span>
        {growth !== 10000 && <b className={growth > 10000 ? "up" : "down"}>{growth > 10000 ? t("colony.factorUp") : t("colony.factorDown")}</b>}
      </p>
      {effects.length === 0 ? (
        <EmptyState className="is-compact" text={t("colony.effectsNone")} />
      ) : (
        <ul className="colony-events">
          {effects.map((x, i) => {
            const left = x.end !== null && x.end !== undefined ? Math.max(0, x.end - today) : null;
            const up = (x.mult_bp ?? 10000) >= 10000 && (x.delta ?? 0) >= 0;
            return (
              <li key={`${x.effect}-${i}`} className={up ? "colony-event is-up" : "colony-event is-down"} data-testid={`colony-effect-${i}`}>
                <strong className="colony-event-label">{x.label}</strong>
                <span className="colony-event-text">{eventText(x, { omitColony: true })}</span>
                {left !== null && x.end !== null && x.end !== undefined && (
                  <small className="colony-event-left">
                    {left > 0 ? t("colony.effectLeft", { days: left, end: x.end }) : t("colony.effectLastDay")}
                  </small>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** 建筑每级的效果文字（仓储、防御、民心、住宅、码头）；生产类返回 null。 */
function effectText(d: ColonyBuildingView, level: number): string | null {
  switch (d.kind) {
    case "storage":
      return t("colony.effectCapacity", { n: d.capacity * level });
    case "defense":
      return t("colony.effectDefense", { n: d.defense * level });
    case "morale":
      return t("colony.effectMorale", { n: d.morale * level });
    case "housing":
      return t("colony.effectHousing", { n: d.housing * level });
    case "dock":
      return t("colony.effectDock");
    default:
      return null;
  }
}

/** 等级的小方格（装饰）。 */
function Pips({ level, max }: { level: number; max: number }) {
  return (
    <span className="colony-pips" aria-hidden="true">
      {Array.from({ length: Math.max(1, max) }, (_, i) => (
        <i key={i} className={i < level ? "on" : ""} />
      ))}
    </span>
  );
}

function BuildingCard({
  statics,
  colony,
  building,
  level,
  focused,
}: {
  statics: StaticView;
  colony: ColonyView;
  building: number;
  level: number;
  focused: boolean;
}) {
  const d = buildingDef(statics, building);
  if (!d) return null;
  const est = colony.estimates.find((e) => e.building === building);
  const effect = effectText(d, level);
  const producing = !!est && (est.outputs.length > 0 || est.inputs.length > 0);
  return (
    <li
      className={focused ? `colony-card is-focus kind-${d.kind}` : `colony-card kind-${d.kind}`}
      data-building={building}
      data-testid={`colony-building-${building}`}
    >
      <BuildingIcon statics={statics} building={building} />
      <div className="colony-card-main">
        <header className="colony-card-head">
          <strong>{d.name}</strong>
          <span className="pn-level small">{t("colony.levelOf", { level, max: d.max_level })}</span>
        </header>
        <Pips level={level} max={d.max_level} />
        <small className="colony-kind">{tk(`colonyKind.${d.kind}`)}</small>
        {effect && <p className="colony-effect">{effect}</p>}
        {producing && est && (
          <p className="colony-flow">
            {est.outputs.map(([g, q]) => (
              <GoodChip key={`o${g}`} statics={statics} good={g}>
                {t("colony.gain", { qty: perDay(q) })}
              </GoodChip>
            ))}
            {est.inputs.map(([g, q]) => (
              <GoodChip key={`i${g}`} statics={statics} good={g} bad>
                {t("colony.spend", { qty: q })}
              </GoodChip>
            ))}
          </p>
        )}
        {!effect && !producing && <p className="colony-effect muted">{t("colony.idle")}</p>}
        <small className="colony-card-foot">
          {t("colony.workersNeed", { n: d.workers * level })} · {t("colony.upkeep", { v: d.upkeep * level })}
        </small>
      </div>
    </li>
  );
}

function Construction({ statics, colony, today }: { statics: StaticView; colony: ColonyView; today: number }) {
  const c = colony.construction;
  if (!c) return <EmptyState className="is-compact" text={t("colony.noConstruction")} hint={t("v2.business.col.noConstructionHint")} />;
  const d = buildingDef(statics, c.building);
  const total = Math.max(1, c.done_day - c.start_day);
  const done = Math.max(0, Math.min(total, today - c.start_day));
  return (
    <div className="colony-construct" data-testid="colony-construction">
      <BuildingIcon statics={statics} building={c.building} />
      <div className="colony-construct-main">
        <strong>{t("colony.constructing", { name: d?.name ?? "", level: c.level })}</strong>
        <Meter value={done} max={total} tone="build" />
        <small>{t("colony.constructDone", { day: c.done_day, days: Math.max(0, c.done_day - today) })}</small>
      </div>
    </div>
  );
}

function OptionCard({ statics, colony, option: o }: { statics: StaticView; colony: ColonyView; option: BuildOptionView }) {
  const submit = useGame((s) => s.submit);
  const d = buildingDef(statics, o.building);
  if (!d) return null;
  const missing = new Map(o.missing);
  const effect = effectText(d, 1);
  const extracts = d.kind === "food" || d.kind === "extract";
  return (
    <li className={o.ok ? "colony-card colony-option" : "colony-card colony-option is-blocked"} data-testid={`colony-option-${o.building}`}>
      <BuildingIcon statics={statics} building={o.building} />
      <div className="colony-card-main">
        <header className="colony-card-head">
          <strong>{d.name}</strong>
          <span className={o.level === 0 ? "colony-tag new" : "colony-tag"}>
            {o.level === 0 ? t("colony.buildNew") : t("colony.buildUpgrade", { from: o.level, to: o.level + 1 })}
          </span>
        </header>
        <p className="colony-cost">
          <Icon name="coin" />
          <span>{t("colony.cost", { v: o.cost })}</span>
          <Icon name="clock" className="colony-gap" />
          <span>{t("colony.buildDays", { n: o.build_days })}</span>
        </p>
        {o.materials.length > 0 && (
          <p className="colony-flow">
            <span className="colony-flow-label">{t("colony.materials")}</span>
            {o.materials.map(([g, q]) => {
              const miss = missing.get(g) ?? 0;
              return (
                <GoodChip key={g} statics={statics} good={g} bad={miss > 0}>
                  {t("colony.times", { n: q })}
                  {miss > 0 && <em className="colony-miss">{t("colony.missing", { n: miss })}</em>}
                </GoodChip>
              );
            })}
          </p>
        )}
        {o.produces ? (
          <p className="colony-flow">
            <span className="colony-flow-label">{t("colony.output")}</span>
            <GoodChip statics={statics} good={o.produces[0]}>
              {t("colony.gain", { qty: perDay(d.output * o.produces[1] * 100) })}
            </GoodChip>
            <small>{t("colony.produces", { good: statics.goods[o.produces[0]]?.name ?? "", pct: o.produces[1] })}</small>
          </p>
        ) : extracts ? (
          <p className="colony-effect muted">{t("colony.noProduce")}</p>
        ) : effect ? (
          <p className="colony-effect">{effect}</p>
        ) : null}
        <small className="colony-card-foot">
          {t("colony.workersNeed", { n: d.workers })} · {t("colony.upkeep", { v: d.upkeep })}
        </small>
        {!o.ok && o.reason && <p className="colony-reason">{o.reason}</p>}
        <div className="colony-card-actions">
          <ActionButton
            kind="primary"
            disabled={!o.ok}
            onClick={() => submit({ BuildColony: { owner: "player", colony: colony.id, building: o.building } })}
          >
            {o.level === 0 ? t("colony.buildBtn") : t("colony.upgradeBtn")}
          </ActionButton>
        </div>
      </div>
    </li>
  );
}

function TaxPicker({ statics, colony }: { statics: StaticView; colony: ColonyView }) {
  const submit = useGame((s) => s.submit);
  const levels = taxLevels(statics, colony);
  return (
    <>
      <div className="colony-tax" role="radiogroup" aria-label={t("colony.taxGroup")}>
        {levels.map((lv) => {
          const on = lv.index === colony.tax;
          return (
            <button
              key={lv.index}
              type="button"
              role="radio"
              aria-checked={on}
              className={on ? "colony-tax-step is-on" : "colony-tax-step"}
              onClick={() => {
                if (!on) void submit({ SetColonyTax: { owner: "player", colony: colony.id, rate: lv.index } });
              }}
            >
              <strong>{tk(`colonyTax.${lv.index}`)}</strong>
              <small>{t("colony.taxShare", { pct: lv.share })}</small>
              <small className={lv.morale > 0 ? "up" : lv.morale < 0 ? "down" : ""}>
                {t("colony.taxMorale", { delta: signed(lv.morale) })}
              </small>
              {lv.income !== null && <small>{t("colony.taxIncome", { v: lv.income })}</small>}
            </button>
          );
        })}
      </div>
      <p className="colony-note">{t("colony.taxHint")}</p>
    </>
  );
}

function StockList({ statics, colony }: { statics: StaticView; colony: ColonyView }) {
  const items = colony.stock.filter((c) => c.qty > 0);
  return (
    <div className="colony-stock">
      <p className="colony-line">
        {t("colony.capacity", { used: colony.used, capacity: colony.capacity })}
        <Meter value={colony.used} max={colony.capacity} tone="cargo" warn={colony.used >= colony.capacity} />
      </p>
      {items.length === 0 ? (
        <EmptyState className="is-compact" text={t("colony.stockEmpty")} hint={t("v2.business.col.stockEmptyHint")} />
      ) : (
        <p className="colony-flow">
          {items.map((c) => (
            <GoodChip key={c.good} statics={statics} good={c.good}>
              {t("colony.times", { n: c.qty })}
            </GoodChip>
          ))}
        </p>
      )}
    </div>
  );
}

function MonthStats({ statics, colony }: { statics: StaticView; colony: ColonyView }) {
  const m = colony.last_month;
  return (
    <dl className="colony-month" data-testid="colony-month">
      <dt>{t("colony.mProduced")}</dt>
      <dd className="colony-flow">
        {m.produced.length === 0
          ? t("none")
          : m.produced.map(([g, q]) => (
              <GoodChip key={g} statics={statics} good={g}>
                {t("colony.times", { n: q })}
              </GoodChip>
            ))}
      </dd>
      <dt>{t("colony.mFood")}</dt>
      <dd>{t("colony.mPieces", { n: m.food_eaten })}</dd>
      <dt>{t("colony.mBirths")}</dt>
      <dd className="up">{t("colony.mPeople", { n: m.births })}</dd>
      <dt>{t("colony.mImmigrants")}</dt>
      <dd className="up">{t("colony.mPeople", { n: m.immigrants })}</dd>
      <dt>{t("colony.mDeaths")}</dt>
      <dd className={m.deaths > 0 ? "down" : ""}>{t("colony.mPeople", { n: m.deaths })}</dd>
      <dt>{t("colony.mTax")}</dt>
      <dd className="up">{money(m.tax)}</dd>
      <dt>{t("colony.mUpkeep")}</dt>
      <dd className="down">{money(m.upkeep)}</dd>
      <dt>{t("colony.mSatisfaction")}</dt>
      <dd>{t("colony.tilePct", { n: Math.round(m.satisfaction_bp / 100) })}</dd>
    </dl>
  );
}

function Abandon({ colony }: { colony: ColonyView }) {
  const submit = useGame((s) => s.submit);
  const [asking, setAsking] = useState(false);
  const v2 = useIsV2();
  const confirm = useConfirm();
  if (v2) {
    return (
      <>
        <button
          type="button"
          className="btn danger"
          onClick={() =>
            void confirm.run(
              {
                title: t("v2.business.col.abandonAsk", { name: colony.name }),
                body: t("colony.abandonWarn", { name: colony.name }),
                confirmLabel: t("v2.business.col.abandonConfirm", { name: colony.name }),
                done: t("v2.business.col.abandonDone", { name: colony.name }),
              },
              // 办成就在这里取消选中（与旧界面相同）：殖民地没了、这张详情随时可能卸下，不等对话框的回答
              async () => {
                const r = await submit({ AbandonColony: { owner: "player", colony: colony.id } });
                if (r) useGame.getState().selectColony(null);
                return r;
              },
            )
          }
        >
          {t("colony.abandonBtn")}
        </button>
        {confirm.dialog}
      </>
    );
  }
  if (!asking) {
    return (
      <button type="button" className="btn danger" onClick={() => setAsking(true)}>
        {t("colony.abandonBtn")}
      </button>
    );
  }
  return (
    <div className="colony-confirm" role="alertdialog" aria-label={t("colony.abandonBtn")}>
      <p>{t("colony.abandonWarn", { name: colony.name })}</p>
      <div className="row">
        <ActionButton
          kind="danger"
          onClick={async () => {
            const r = await submit({ AbandonColony: { owner: "player", colony: colony.id } });
            if (r) {
              setAsking(false);
              useGame.getState().selectColony(null);
            }
          }}
        >
          {t("colony.abandonConfirm")}
        </ActionButton>
        <button type="button" className="btn" onClick={() => setAsking(false)}>
          {t("colony.cancel")}
        </button>
      </div>
    </div>
  );
}
