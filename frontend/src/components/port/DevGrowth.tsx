// E02 港口投资页最上面的“发展度”卡：这座港现在是什么阶段、离下一阶段多远、上个月为什么涨（或为什么掉）、
// 再投钱会怎样。一眼看懂为先：阶段名与一条进度条；上月构成画成左右两向的短条（涨的往右、回落往左），只列不为 0 的项；
// 底下三行人话——来往的生意与世界平均比、高出本来水平的部分怎么回落、下一点的价钱与到下一阶段还要多少、船厂哪一阶段多卖一档。
// 数字全部来自 InvestView.growth（规则关着的世界、旧后端没有这张卡）；“投一笔涨几点”与内核同式，见 devScale.ts。
import { money, num } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import type { DevGrowthView, YardStepView } from "../../ipc/types";
import {
  GROWTH_PARTS,
  costToReach,
  nextYardStep,
  partValue,
  pointsText,
  previewInvest,
  stageName,
  stageOf,
  stageProgress,
  stageScene,
  timesText,
} from "./devScale";
import { StageUnlocks } from "./StageUnlocks";

/** 一条进度条：本阶段从下界走到下一阶段的门槛。 */
function StageBar({ g }: { g: DevGrowthView }) {
  const p = stageProgress(g);
  const next = g.stage_to;
  return (
    <div className="dev-stage" data-testid="dev-stage">
      <div className="dev-bar" role="progressbar" aria-valuemin={g.stage_from} aria-valuemax={next ?? g.max} aria-valuenow={g.value} aria-label={tz("dev.barLabel")}>
        <span style={{ width: `${Math.round(p * 1000) / 10}%` }} />
      </div>
      <p className="dev-bar-ends">
        <span>{num(g.stage_from)}</span>
        {next != null ? (
          <span data-testid="dev-to-next">{tz("dev.toNext", { stage: stageName(g.stage + 1), dev: num(next), n: num(Math.max(0, next - g.value)) })}</span>
        ) : (
          <span>{tz("dev.top")}</span>
        )}
      </p>
    </div>
  );
}

/** 上个月的增长构成：只列不为 0 的项，条长按最大的一项。 */
function LastMonth({ g }: { g: DevGrowthView }) {
  const m = g.last;
  if (!m) {
    return (
      <p className="sub dev-last-none" data-testid="dev-last-none">
        {tz("dev.lastNone")}
      </p>
    );
  }
  const rows = GROWTH_PARTS.map((part) => ({ part, v: partValue(m, part) })).filter((r) => Math.round(r.v / 100) !== 0);
  const peak = Math.max(1, ...rows.map((r) => Math.abs(r.v)));
  return (
    <div className="dev-last" data-testid="dev-last">
      <p className="dev-net">
        <span>{tz("dev.lastTitle")}</span>{" "}
        <strong className={m.net > 0 ? "dev-up" : m.net < 0 ? "dev-down" : undefined} data-testid="dev-net">
          {tz("dev.points", { v: pointsText(m.net) })}
        </strong>
        <span className="sub">
          {" "}
          {m.net > 0 ? tz("dev.netUp") : m.net < 0 ? tz("dev.netDown") : tz("dev.netFlat")}
        </span>
      </p>
      {rows.length > 0 && (
        <ul className="dev-parts" aria-label={tz("dev.partsLabel")}>
          {rows.map(({ part, v }) => (
            <li key={part} className={v >= 0 ? "is-up" : "is-down"} data-testid={`dev-part-${part}`} title={tz(`dev.partHint.${part}`)}>
              <span className="dev-part-name">{tz(`dev.part.${part}`)}</span>
              <span className="dev-part-track" aria-hidden="true">
                <i style={{ width: `${Math.max(4, Math.round((Math.abs(v) / peak) * 50))}%` }} />
              </span>
              <span className="dev-part-v">{pointsText(v)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface DevGrowthCardProps {
  growth: DevGrowthView;
  /** 船厂的台阶（HouseView.yard_steps；没有船厂时缺省） */
  yardSteps?: YardStepView[];
}

/** 投资页最上面的发展度卡。 */
export function DevGrowthCard({ growth: g, yardSteps }: DevGrowthCardProps) {
  const rel = g.last?.rel_bp;
  const above = g.value - g.base;
  const next = g.stage_to;
  const toNextCost = next != null ? costToReach(g, next) : 0;
  const yard = nextYardStep(yardSteps);
  return (
    <section className="house-card dev-card" data-testid="dev-card" aria-label={tz("dev.title")} title={tz("dev.depthHint")}>
      <h4 className="house-card-title dev-head">
        <span>{tz("dev.title")}</span>
        <strong className="dev-name" data-testid="dev-name">
          {stageName(g.stage)}
        </strong>
        <span className="dev-value" data-testid="dev-value">
          {num(g.value)}
        </span>
        <span className="sub dev-depth">{tz("dev.depthLine", { x: timesText(g.depth_bp) })}</span>
      </h4>
      <p className="sub dev-scene">{stageScene(g.stage)}</p>
      <StageBar g={g} />
      <LastMonth g={g} />
      <ul className="dev-why">
        <li data-testid="dev-why-busy">
          {rel != null ? tz("dev.why.busy", { x: timesText(rel), speed: pointsText(g.speed_bp) }) : tz("dev.why.speed", { speed: pointsText(g.speed_bp) })}
        </li>
        <li data-testid="dev-why-decay" title={tz("dev.decayHint", { pct: timesText(g.decay_bp * 100), base: num(g.base) })}>
          {above > 0
            ? tz("dev.why.decay", { base: num(g.base), n: num(above), pct: timesText(g.decay_bp * 100) })
            : tz("dev.why.atBase", { base: num(g.base) })}
        </li>
        <li data-testid="dev-why-cost">
          {tz("dev.why.cost", { cost: money(g.point_cost) })}
          {g.frac_bp > 0 && tz("dev.why.frac", { v: pointsText(g.frac_bp).replace("+", "") })}
          {next != null && tz("dev.why.toNext", { stage: stageName(g.stage + 1), cost: money(toNextCost) })}
        </li>
        {yard && (
          <li data-testid="dev-why-yard">
            {tz("dev.why.yard", { dev: num(yard.development), stage: stageName(stageOf(yard.development)), n: num(Math.max(0, yard.development - g.value)) })}
          </li>
        )}
      </ul>
      <StageUnlocks unlocks={g.unlocks} stage={g.stage} />
    </section>
  );
}

/** 自己定金额的柜台下面：这笔钱投下去预计涨几点。 */
export function InvestPreviewLine({ growth, amount }: { growth: DevGrowthView; amount: number }) {
  const p = previewInvest(growth, amount);
  const stageUp = stageOf(p.value) > growth.stage;
  return (
    <p className="sub dev-preview" data-testid="dev-preview">
      {growth.value >= growth.max
        ? tz("dev.previewMax")
        : p.gain > 0
        ? tz("dev.preview", { amount: money(amount), n: num(p.gain), from: num(growth.value), to: num(p.value) })
        : tz("dev.previewFrac", { amount: money(amount), v: pointsText(p.frac_bp - growth.frac_bp).replace("+", "") })}
      {stageUp && <> {tz("dev.previewStage", { stage: stageName(stageOf(p.value)) })}</>}
    </p>
  );
}
