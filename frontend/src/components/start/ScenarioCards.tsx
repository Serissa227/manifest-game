// 剧本卡片：剧本名、描述、起始港、资金、船队、开局货物、目标与纪年；整张卡片可点，键盘用方向键在单选组里切换。
// 小景的建筑风格取起始港所属势力的 style 字段（FactionView.style），没有时按势力 key 推断。
// 数据里有“推荐选择”（带主角与故事线的剧本，recommended）时分两组：推荐角色排在最前面、加亮，卡片上是角色的头像、
// 姓名、一句话介绍与故事线；其余剧本在“自由开局”一组里照旧。整页仍是一个单选组。
import { townStyleOf } from "../../art/buildings";
import { captainAssetId } from "../../art/portraitCast";
import { Sprite } from "../../art/Sprite";
import { DEFAULT_START_YEAR, eraName, money, t, tk, yearDays } from "../../i18n";
import type { ScenarioView, StaticView } from "../../ipc/types";
import { PortraitArt } from "../portrait/PortraitArt";
import { captainPortrait, isRecommended, scenarioFacts, type ScenarioGoal } from "./captain";
import { drawScenarioVignette } from "./titleArt";

/** 目标文字：净资产用金额；殖民地目标带人口门槛（“拥有 3 个人口 ≥ 400 的殖民地”）；有限期时附上年数。 */
function goalText(goal: ScenarioGoal): string {
  const target = goal.kind === "net_worth" ? money(goal.target) : goal.target;
  const main =
    goal.kind === "colonies" && typeof goal.population === "number"
      ? t("start.goal.coloniesPopulation", { target, population: goal.population })
      : tk(`start.goal.${goal.kind}`, { target });
  return goal.years ? main + t("start.goalYears", { years: goal.years }) : main;
}

/**
 * 开局货物一行：“木材 ×70、谷物 ×90、铁器 ×10 · 粮 80 · 水 80”（旧后端没有 cargo 时为 null；
 * 没有货物也没有粮水时同样为 null，不显示这一行）。
 */
function cargoText(statics: StaticView, s: ScenarioView): string | null {
  const items = (s.cargo ?? [])
    .filter((c) => c.qty > 0)
    .map((c) => t("start.scenarioCargoItem", { name: statics.goods[c.good]?.name ?? String(c.good), qty: c.qty }));
  const parts: string[] = [];
  if (items.length > 0) parts.push(items.join(t("start.listSep")));
  if ((s.food ?? 0) > 0 || (s.water ?? 0) > 0) parts.push(t("start.scenarioSupplies", { food: s.food ?? 0, water: s.water ?? 0 }));
  return parts.length > 0 ? parts.join(t("start.factSep")) : null;
}

/** 卡片上的事实：起始港与资金、船队、开局货物、目标与纪年。 */
function Facts({ statics, s, era, startYear, withEra }: { statics: StaticView; s: ScenarioView; era: string; startYear: number; withEra: boolean }) {
  const f = scenarioFacts(statics, s);
  // 多艘起始船只时逐一列出船型（如“移民船、单桅快船”），一艘时照旧
  const ships = f.shipNames && f.shipNames.length > 1 ? f.shipNames.join(t("start.listSep")) : f.ship?.name;
  const cargo = cargoText(statics, s);
  return (
    <span className="ts-facts">
      {(f.port || f.cash !== undefined) && (
        <span className="ts-fact-pair">
          {f.port && (
            <span className="ts-fact">
              <span className="ts-fact-k">{t("start.scenarioStart")}</span>
              <span className="ts-fact-v">{f.port}</span>
            </span>
          )}
          {f.cash !== undefined && (
            <span className="ts-fact">
              <span className="ts-fact-k">{t("start.scenarioCash")}</span>
              <span className="ts-fact-v ts-num">{money(f.cash)}</span>
            </span>
          )}
        </span>
      )}
      {f.ship && (
        <span className="ts-fact">
          <span className="ts-fact-k">{t("start.scenarioFleet")}</span>
          <span className="ts-fact-v">
            {t("start.scenarioShip", { ship: ships ?? f.ship.name, crew: f.crew ?? 0 })}
            {f.mates ? ` · ${t("start.scenarioMates", { n: f.mates })}` : ""}
          </span>
        </span>
      )}
      {cargo && (
        <span className="ts-fact" data-testid={`scenario-cargo-${s.key}`}>
          <span className="ts-fact-k">{t("start.scenarioCargo")}</span>
          <span className="ts-fact-v">{cargo}</span>
        </span>
      )}
      {f.goal && (
        <span className="ts-fact">
          <span className="ts-fact-k">{t("start.scenarioGoal")}</span>
          <span className="ts-fact-v">
            {goalText(f.goal)}
            {f.goal.years ? <small className="ts-fact-until">{t("start.goalUntil", { day: f.goal.years * yearDays() })}</small> : null}
          </span>
        </span>
      )}
      {withEra && era && (
        <span className="ts-fact">
          <span className="ts-fact-k">{t("start.scenarioEra")}</span>
          <span className="ts-fact-v">{t("start.scenarioEraValue", { era, year: startYear })}</span>
        </span>
      )}
    </span>
  );
}

/** 普通剧本的卡片（小景 + 剧本名、描述与事实）。 */
function ScenarioCard({
  statics,
  s,
  i,
  selected,
  onChoose,
  era,
  startYear,
}: {
  statics: StaticView;
  s: ScenarioView;
  i: number;
  selected: boolean;
  onChoose: (key: string) => void;
  era: string;
  startYear: number;
}) {
  const f = scenarioFacts(statics, s);
  const art = drawScenarioVignette({
    style: townStyleOf(f.factionKey, f.factionStyle),
    ship: f.ship ? { type: f.ship.type, sail: f.ship.sail, key: f.ship.key } : undefined,
    flag: f.flag,
    variant: i,
  });
  return (
    <label className={selected ? "ts-card is-selected" : "ts-card"}>
      <input type="radio" name="scenario" className="ts-sr" value={s.key} checked={selected} onChange={() => onChoose(s.key)} />
      <span className="ts-card-art">
        <Sprite px={art} scale={1} />
        {selected && <span className="ts-card-seal">{t("start.chosen")}</span>}
      </span>
      <span className="ts-card-body">
        <strong className="ts-card-name">{s.name}</strong>
        <span className="ts-card-desc">{s.description}</span>
        <Facts statics={statics} s={s} era={era} startYear={startYear} withEra />
      </span>
    </label>
  );
}

/** 推荐角色的卡片：头像、“推荐”标签、姓名与一句话介绍、故事线与开局事实。 */
function HeroCard({
  statics,
  s,
  selected,
  onChoose,
  era,
  startYear,
}: {
  statics: StaticView;
  s: ScenarioView;
  selected: boolean;
  onChoose: (key: string) => void;
  era: string;
  startYear: number;
}) {
  const hero = s.hero;
  if (!hero) return null;
  return (
    <label className={selected ? "ts-card is-recommended is-selected" : "ts-card is-recommended"} data-testid={`hero-card-${s.key}`}>
      <input type="radio" name="scenario" className="ts-sr" value={s.key} checked={selected} onChange={() => onChoose(s.key)} />
      <span className="ts-card-badge">{t("start.heroBadge")}</span>
      <span className="ts-hero-art">
        <PortraitArt
          asset={captainAssetId(hero.look)}
          fallback={() => captainPortrait(hero.look)}
          size={200}
          variant="full"
          label={t("start.heroPortraitLabel", { name: hero.name })}
          live
        />
        {selected && <span className="ts-card-seal">{t("start.chosen")}</span>}
      </span>
      <span className="ts-card-body">
        <strong className="ts-hero-name">{hero.name}</strong>
        <span className="ts-hero-tagline">{hero.tagline}</span>
        {s.story && <span className="ts-hero-story">{t("start.heroStory", { name: s.story.name, n: s.story.chapters })}</span>}
        <Facts statics={statics} s={s} era={era} startYear={startYear} withEra={false} />
      </span>
    </label>
  );
}

export default function ScenarioCards({
  statics,
  chosen,
  onChoose,
  headingId,
}: {
  statics: StaticView;
  chosen: string;
  onChoose: (key: string) => void;
  headingId: string;
}) {
  // 纪年：剧本都从 start_year 年 1 月 1 日开始（旧数据没有 world 时用默认值）
  const era = statics.world?.era ? eraName(statics.world.era) : "";
  const startYear = statics.world?.start_year ?? DEFAULT_START_YEAR;
  const heroes = statics.scenarios.filter(isRecommended);
  const card = (s: ScenarioView, i: number) => (
    <ScenarioCard key={s.key} statics={statics} s={s} i={i} selected={chosen === s.key} onChoose={onChoose} era={era} startYear={startYear} />
  );
  if (heroes.length === 0) {
    return (
      <div className="ts-cards" role="radiogroup" aria-labelledby={headingId}>
        {statics.scenarios.map(card)}
      </div>
    );
  }
  const others = statics.scenarios.map((s, i) => [s, i] as const).filter(([s]) => !isRecommended(s));
  return (
    <div className="ts-groups" role="radiogroup" aria-labelledby={headingId}>
      <section className="ts-group is-recommended" data-testid="scenario-recommended">
        <p className="ts-group-head">
          <strong>{t("start.recommended")}</strong>
          <small>{t("start.recommendedHint")}</small>
        </p>
        <div className="ts-cards ts-cards-hero">
          {heroes.map((s) => (
            <HeroCard key={s.key} statics={statics} s={s} selected={chosen === s.key} onChoose={onChoose} era={era} startYear={startYear} />
          ))}
        </div>
      </section>
      {others.length > 0 && (
        <section className="ts-group" data-testid="scenario-free">
          <p className="ts-group-head">
            <strong>{t("start.freeStart")}</strong>
            <small>{t("start.freeStartHint")}</small>
          </p>
          <div className="ts-cards">{others.map(([s, i]) => card(s, i))}</div>
        </section>
      )}
    </div>
  );
}
