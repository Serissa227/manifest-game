// 推荐角色的启航页：小传、剧本与故事线、生辰、身世五问、属性与开局效果（都已定好，只读）。
import { t, tk } from "../../i18n";
import type { CaptainDefsView, HeroView, ScenarioView, StaticView } from "../../ipc/types";
import { methodName } from "../../forecast/labels";
import { attributeName, bornText, effectText } from "./captainText";
import { ATTRIBUTE_KEYS, birthYear, heroAttrs, optionOf, signOf, startEffects } from "./wizard";

export function HeroSummary({
  defs,
  statics,
  scenario,
  hero,
  port,
  startYear,
}: {
  defs: CaptainDefsView;
  statics: StaticView;
  scenario: ScenarioView;
  hero: HeroView;
  port?: string;
  startYear: number;
}) {
  const sign = signOf(defs, hero.month, hero.day);
  const { attrs } = heroAttrs(defs, hero);
  const effects = startEffects(defs, hero.answers);
  return (
    <div className="ts-hero-summary" data-testid="hero-summary">
      <p className="ts-lead">{t("start.heroLead")}</p>
      <p className="ts-hero-bio">{hero.bio}</p>
      <dl className="cw-summary" data-testid="cw-summary">
        <div className="cw-summary-row">
          <dt>{t("cap.cf.scenario")}</dt>
          <dd>{port ? t("cap.cf.scenarioValue", { scenario: scenario.name, port }) : scenario.name}</dd>
        </div>
        {scenario.story && (
          <div className="cw-summary-row">
            <dt>{t("start.heroStoryLabel")}</dt>
            <dd>{t("start.heroStoryValue", { name: scenario.story.name, n: scenario.story.chapters })}</dd>
          </div>
        )}
        <div className="cw-summary-row">
          <dt>{t("cap.cf.born")}</dt>
          <dd>
            {bornText(statics.world?.era, birthYear(startYear, hero.age), hero.month, hero.day)}
            {sign && <span className="cw-card-sign">{sign.name}</span>}
          </dd>
        </div>
        <div className="cw-summary-row">
          <dt>{t("cap.cf.background")}</dt>
          <dd>{hero.answers.map((a, qi) => optionOf(defs, qi, a)?.name ?? t("cap.card.unanswered")).join(tk("start.factSep"))}</dd>
        </div>
        <div className="cw-summary-row">
          <dt>{t("cap.cf.attrs")}</dt>
          <dd>{ATTRIBUTE_KEYS.map((k, i) => t("cap.card.attr", { name: attributeName(defs, k), value: attrs[i] ?? 0 })).join(tk("start.factSep"))}</dd>
        </div>
        {hero.genius && (
          <div className="cw-summary-row">
            <dt>{t("cap.cf.genius")}</dt>
            <dd>{methodName(hero.genius)}</dd>
          </div>
        )}
        <div className="cw-summary-row">
          <dt>{t("cap.cf.effects")}</dt>
          <dd>{effects.length > 0 ? effects.map((e) => effectText(e, statics)).join(tk("start.listSep")) : t("cap.cf.noEffects")}</dd>
        </div>
      </dl>
    </div>
  );
}
