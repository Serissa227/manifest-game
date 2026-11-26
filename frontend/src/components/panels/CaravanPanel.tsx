// 商队窗口：路线规划（出发地、目的地、驮畜、数量、护卫、估算货值 → 天数、距离、关卡税、风险、开销与逐段路况）与“我的商队”。
// 新界面（v2）只在样式之外做了几处小的结构调整（旧界面不变）：规划结果拆成五项小数字；“组建商队”是主按钮；
// 商队卡片的标题与副标题分开；解散前先确认，驮着货时按钮不可用并就地写明原因（内核同样拒绝）；没有商队时空状态写一句怎么开始。
import { GoodGlyphOf } from "./GoodGlyph";
import { useEffect, useId, useState } from "react";
import { drawGuard } from "../../art/extras";
import { Sprite } from "../../art/Sprite";
import { useFrames } from "../../art/useFrames";
import { money, pct, t } from "../../i18n";
import { api } from "../../ipc/api";
import { locById } from "../../ipc/byId";
import type { CaravanPlanView, CaravanView, StaticView } from "../../ipc/types";
import { useGame, useOverviewFields } from "../../store/game";
import { useIsV2 } from "../../ui/uiMode";
import { ActionButton, NumInput, Select } from "../common";
import { EmptyState, InlineError, useConfirm } from "../feedback";
import { openWindow } from "../shell/shellState";
import { Icon, PnSection } from "./PanelKit";
import { animalPx } from "./panelArt";

/** 最多画几头驮畜、几名护卫（多出的用“×N”表示）。 */
const MAX_ANIMALS = 5;
const MAX_GUARDS = 4;
/** 逐段路况标“危险”的门槛：每日遭劫概率 ≥ 1%（万分点）。v2 规划结果里“遭劫风险”标红用同一个门槛、同一个口径。 */
const RISKY_DAILY_BP = 100;

/** 商队的队列画面：驮畜一字排开，护卫走在最后；在路上时迈步。 */
function Train({ animal, count, guards, walking = false }: { animal: number; count: number; guards: number; walking?: boolean }) {
  const [step, setStep] = useState(0);
  useFrames(3, (f) => setStep(f % 2), walking);
  const shown = Math.max(0, Math.min(count, MAX_ANIMALS));
  const guardShown = Math.max(0, Math.min(guards, MAX_GUARDS));
  return (
    <span className="pn-train" aria-hidden="true">
      {Array.from({ length: guardShown }, (_, i) => (
        <Sprite key={`g${i}`} px={drawGuard()} scale={2} className="pn-train-guard" />
      ))}
      {Array.from({ length: shown }, (_, i) => (
        <Sprite key={`a${i}`} px={animalPx(animal, (i + step) % 2)} scale={2} className="pn-train-animal" />
      ))}
      {count > shown && <span className="pn-train-more">×{count}</span>}
    </span>
  );
}

function CaravanCard({
  c,
  statics,
  to,
  guards,
  name,
}: {
  c: CaravanView;
  statics: StaticView;
  to: number;
  guards: number;
  name: (id: number | null | undefined) => string;
}) {
  const submit = useGame((s) => s.submit);
  const v2 = useIsV2();
  const confirm = useConfirm();
  const blockedId = useId();
  const used = c.cargo.reduce((a, g) => a + g.qty, 0);
  const disband = () => submit({ DisbandCaravan: { owner: "player", caravan: c.id } });
  // v2：驮着货不能解散（内核的规则），按钮不可用并就地写明原因
  const loaded = v2 && used > 0;
  return (
    <article className="pn-card pn-caravan">
      {v2 ? (
        <header className="pn-caravan-head v2-cv-head">
          <strong className="v2-cv-name">{t("holder.caravan", { id: c.id })}</strong>
          <span className="v2-cv-meta">
            {t("v2.business.cv.meta", {
              animal: statics.animals[c.animal]?.name ?? "",
              count: c.count,
              guards: c.guards,
              cost: money(c.daily_cost),
            })}
          </span>
        </header>
      ) : (
        <header className="pn-caravan-head">
          <strong>{t("holder.caravan", { id: c.id })}</strong> · {statics.animals[c.animal]?.name} × {c.count} ·{" "}
          {t("cvGuards")} {c.guards} · {money(c.daily_cost)}/{t("unitDays", { v: 1 })}
        </header>
      )}
      <div className="pn-caravan-road">
        <Train animal={c.animal} count={c.count} guards={c.guards} walking={c.leg !== null} />
      </div>
      <p className="pn-caravan-where">
        <Icon name={c.at !== null ? "anchor" : "map"} />
        {c.at !== null
          ? t("cvStatusAt", { loc: name(c.at) })
          : c.leg
            ? t("cvStatusRoad", {
                from: name(c.leg[0]),
                to: name(c.leg[1]),
                pct: pct(c.leg[2], 0),
                dest: name(c.dest),
              })
            : ""}
      </p>
      {c.leg && (
        <span className="pn-leg-progress" aria-hidden="true">
          <i style={{ width: `${Math.max(0, Math.min(100, c.leg[2] / 100))}%` }} />
        </span>
      )}
      <p className="pn-note">
        <Icon name="cargo" />
        {t("pnCaravanLoad", { used, capacity: c.capacity })}
      </p>
      <ul className="pn-goods">
        {c.cargo.map((g) => (
          <li key={g.good}>
            <GoodGlyphOf statics={statics} good={g.good} scale={1} className="pn-good-icon" />
            <span className="pn-good-name">
              {statics.goods[g.good]?.name} × {g.qty}
            </span>
          </li>
        ))}
      </ul>
      {c.at !== null && (
        <div className="row">
          {/* 装卸货物：打开所在地港口窗口的“仓库”页（装卸台：商队与舰队、仓库之间搬货） */}
          <ActionButton
            onClick={() => {
              const g = useGame.getState();
              g.selectLoc(c.at);
              g.setFacility("warehouse");
              openWindow("port");
            }}
          >
            {t("tr.openDesk")}
          </ActionButton>
          <ActionButton onClick={() => submit({ CaravanTravel: { owner: "player", caravan: c.id, dest: to } })}>
            {t("cvTravel")} → {name(to)}
          </ActionButton>
          <ActionButton onClick={() => submit({ SetGuards: { owner: "player", caravan: c.id, guards } })}>
            {t("paren", { text: t("cvSetGuards"), note: guards })}
          </ActionButton>
          {v2 ? (
            <button
              type="button"
              className="btn danger v2-cv-disband"
              disabled={loaded}
              aria-describedby={loaded ? blockedId : undefined}
              onClick={() =>
                void confirm.run(
                  {
                    title: t("v2.business.cv.disbandAsk", { id: c.id }),
                    body: t("v2.business.cv.disbandBody"),
                    confirmLabel: t("v2.business.cv.disbandConfirm", { id: c.id }),
                    done: t("v2.business.cv.disbandDone", { id: c.id }),
                  },
                  disband,
                )
              }
            >
              {t("cvDisband")}
            </button>
          ) : (
            <ActionButton kind="danger" onClick={disband}>
              {t("cvDisband")}
            </ActionButton>
          )}
        </div>
      )}
      {loaded && c.at !== null && <InlineError tone="blocked" compact id={blockedId} reason={t("v2.business.cv.unloadFirst")} />}
      {confirm.dialog}
    </article>
  );
}

/** 商队：路线规划（距离、天数、关卡税、风险），编组与护卫。 */
export default function CaravanPanel() {
  const statics = useGame((s) => s.statics);
  // 按字段选取（P14a）：只取用到的顶层字段，没变就不重渲染
  const overview = useOverviewFields("caravans");
  const submit = useGame((s) => s.submit);
  const v2 = useIsV2();
  const roadLocs = statics
    ? statics.locations.filter((l) => statics.roads.some((r) => r.from === l.id || r.to === l.id))
    : [];
  const [at, setAt] = useState<number>(roadLocs[0]?.id ?? 0);
  const [to, setTo] = useState<number>(roadLocs[1]?.id ?? 0);
  const [animal, setAnimal] = useState(0);
  const [count, setCount] = useState(4);
  const [guards, setGuards] = useState(2);
  const [cargoValue, setCargoValue] = useState(5000);
  const [plan, setPlan] = useState<CaravanPlanView | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    api
      .caravanPlan({ animal, count, guards, from: at, to, cargo_value: cargoValue })
      .then((p) => {
        if (alive) setPlan(p);
      })
      .catch(() => {
        if (alive) setPlan(null);
      });
    return () => {
      alive = false;
    };
  }, [animal, count, guards, at, to, cargoValue]);

  if (!statics || !overview) return null;
  const name = (id: number | null | undefined) =>
    id === null || id === undefined ? "" : (locById(statics, id)?.name ?? "");
  const locOptions = roadLocs.map((l) => ({ value: l.id, label: l.name }));
  const beast = statics.animals[animal];
  return (
    <div data-testid="caravan-panel" className="pn pn-caravans">
      <PnSection title={t("cvPlan")} icon="map">
        <div className="row">
          <Select label={t("cvFrom")} value={at} options={locOptions} onChange={setAt} />
          <Select label={t("cvTo")} value={to} options={locOptions} onChange={setTo} />
          <Select
            label={t("cvAnimal")}
            value={animal}
            options={statics.animals.map((a) => ({ value: a.id, label: t("paren", { text: a.name, note: money(a.price) }) }))}
            onChange={setAnimal}
          />
        </div>
        {beast && (
          <div className="pn-animal-pick">
            <Train animal={animal} count={count} guards={guards} />
            <span className="pn-animal-info">{t("pnAnimalInfo", { cap: beast.capacity, upkeep: beast.upkeep })}</span>
          </div>
        )}
        <div className="row">
          <NumInput label={t("cvCount")} value={count} min={1} max={200} onChange={setCount} />
          <NumInput label={t("cvGuards")} value={guards} min={0} onChange={setGuards} />
          <NumInput label={t("cvCargoValue")} value={cargoValue} min={0} step={500} onChange={setCargoValue} />
        </div>
        {plan === undefined ? null : plan === null ? (
          <p className="pn-note">{t("cvNoRoute")}</p>
        ) : (
          <div className="pn-route">
            {v2 ? (
              // v2：一句话拆成五项小数字（标签在上、数在下），一眼看到“几天、要花多少、危险不危险”
              <dl data-testid="caravan-plan" className="pn-route-summary v2-cv-plan" aria-label={t("v2.business.cv.planLabel")}>
                <div>
                  <dt>{t("v2.business.cv.days")}</dt>
                  <dd>{t("unitDays", { v: plan.days })}</dd>
                </div>
                <div>
                  <dt>{t("v2.business.cv.distance")}</dt>
                  <dd>{t("v2.business.cv.cells", { n: plan.distance })}</dd>
                </div>
                <div>
                  <dt>{t("v2.business.cv.tolls")}</dt>
                  <dd>{money(plan.tolls)}</dd>
                </div>
                {/* 标红看逐段的每日概率（任一段 ≥ 每日 1%，与下面逐段路况的“危险”一致）；plan.risk_bp 是整条路线累计的概率，
                    路线一长就会过 1%，拿它比会把每段都安全的长路标红 */}
                <div className={plan.legs.some((l) => l.robbery_bp >= RISKY_DAILY_BP) ? "is-risky" : undefined}>
                  <dt>{t("v2.business.cv.risk")}</dt>
                  <dd>{t("v2.business.cv.riskPct", { pct: pct(plan.risk_bp, 1) })}</dd>
                </div>
                <div>
                  <dt>{t("v2.business.cv.upkeep")}</dt>
                  <dd>{money(plan.upkeep)}</dd>
                </div>
              </dl>
            ) : (
              <p data-testid="caravan-plan" className="pn-route-summary">
                {t("cvPlanLine", {
                  days: plan.days,
                  distance: plan.distance,
                  tolls: plan.tolls,
                  risk: pct(plan.risk_bp, 1),
                  upkeep: plan.upkeep,
                })}
              </p>
            )}
            <ol className="pn-legs">
              {plan.legs.map((l) => (
                <li key={l.road} className={l.robbery_bp >= RISKY_DAILY_BP ? "risky" : ""}>
                  {t("cvLeg", {
                    from: name(l.from),
                    to: name(l.to),
                    length: l.length,
                    toll: pct(l.toll_bp),
                    risk: pct(l.robbery_bp),
                  })}
                </li>
              ))}
            </ol>
          </div>
        )}
        {/* v2：这一节唯一的主按钮 */}
        <ActionButton kind={v2 ? "primary" : undefined} onClick={() => submit({ FormCaravan: { owner: "player", at, animal, count } })}>
          {t("paren", { text: t("cvForm"), note: name(at) })}
        </ActionButton>
      </PnSection>
      <PnSection title={t("cvMine")} icon="caravan">
        {overview.caravans.length === 0 ? (
          <EmptyState text={t("cvNone")} hint={t("v2.business.cv.emptyHint")} />
        ) : (
          overview.caravans.map((c) => <CaravanCard key={c.id} c={c} statics={statics} to={to} guards={guards} name={name} />)
        )}
      </PnSection>
    </div>
  );
}
