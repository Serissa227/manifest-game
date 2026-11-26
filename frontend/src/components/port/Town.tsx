// 城镇（docs/ECONOMY.md 6.4、6.5）：港口窗口标题下的人口与繁荣度、“港口投资”页的城镇详情（人口、繁荣度、市况、需求满足度），
// “交易所”页的城镇工坊。数据来自 PortView.people 与 PortView.workshops（人口规则关闭、还没到过或旧后端时为空，这些部分不显示）。
import { dayDate, listJoin, num, pct, t, tk } from "../../i18n";
import type { PeopleView, PortCondition, PortView, StaticView } from "../../ipc/types";
import { useGame } from "../../store/game";
import { Section } from "../common";

/** 繁荣度（万分之一精度的 0–100）→ 整数文字。 */
function prosperityText(bp: number): string {
  return String(Math.round(bp / 10_000));
}

/** 市况标签（平稳不显示）。 */
export function ConditionTag({ condition, testId }: { condition: PortCondition; testId?: string }) {
  if (condition === "stable") return null;
  return (
    <em className={`tag cond cond-${condition}`} title={tk(`portConditionHint.${condition}`)} data-testid={testId}>
      {tk(`portCondition.${condition}`)}
    </em>
  );
}

/** 港口窗口标题下的一行：人口 · 繁荣度（+ 市况标签）。 */
export function TownLine({ people }: { people: PeopleView | null | undefined }) {
  if (!people) return null;
  return (
    <>
      {" · "}
      <span data-testid="town-line">
        {t("townLine", {
          pop: num(people.pop),
          v: prosperityText(people.prosperity_bp),
        })}
      </span>
      <ConditionTag condition={people.condition} testId="town-condition" />
    </>
  );
}

/** “港口投资”页的城镇详情。 */
export function TownSection({ people }: { people: PeopleView | null | undefined }) {
  if (!people) return null;
  const growth = people.growth_bp;
  return (
    <Section title={t("townTitle")} testId="town-section">
      <dl className="kv town-kv">
        <dt>{t("townPopulation")}</dt>
        <dd>
          {t("townPopulationValue", {
            pop: num(people.pop),
            pop0: num(people.pop0),
          })}
          {!people.learning && growth !== 0 && (
            <small className={growth > 0 ? "up" : "down"}>
              {" "}
              {t("townGrowth", {
                sign: growth > 0 ? "+" : "−",
                pct: pct(Math.abs(growth)),
              })}
            </small>
          )}
        </dd>
        <dt>{t("townProsperity")}</dt>
        <dd data-testid="town-prosperity">
          {people.learning
            ? prosperityText(people.prosperity_bp)
            : t("townProsperityValue", {
                v: prosperityText(people.prosperity_bp),
                goal: prosperityText(people.goal_bp),
              })}
        </dd>
        <dt>{t("townCondition")}</dt>
        <dd>
          {people.condition === "stable"
            ? tk("portCondition.stable")
            : t("townConditionSince", {
                condition: tk(`portCondition.${people.condition}`),
                date: dayDate(people.since),
              })}
          <small className="sub"> {tk(`portConditionHint.${people.condition}`)}</small>
        </dd>
      </dl>
      {people.learning ? (
        <p className="sub">{t("townLearning")}</p>
      ) : (
        <>
          <h4 className="town-needs-title">{t("townNeeds")}</h4>
          <ul className="town-needs" data-testid="town-needs">
            {(["essential", "comfort", "luxury"] as const).map((k, i) => {
              const v = Math.max(0, Math.min(10_000, people.sat_bp[i]));
              return (
                <li key={k}>
                  <span className="town-need-name">{tk(`townNeed.${k}`)}</span>
                  <span className="town-meter" aria-hidden>
                    <span style={{ width: `${v / 100}%` }} />
                  </span>
                  <span className="num">{pct(v, 0)}%</span>
                </li>
              );
            })}
          </ul>
          <p className="sub">{t("townNeedsHint")}</p>
        </>
      )}
    </Section>
  );
}

/** 配方一行：名称：投入 → 产出。 */
function recipeLine(statics: StaticView, recipe: number, inputs: [number, number][], output: number, qty: number): string {
  const good = (g: number) => statics.goods[g]?.name ?? String(g);
  return t("wsRecipe", {
    name: statics.recipes[recipe]?.name ?? String(recipe),
    inputs: listJoin(inputs.map(([g, q]) => t("wsInput", { good: good(g), qty: q }))),
    output: good(output),
    qty,
  });
}

/** “交易所”页的城镇工坊。 */
export function Workshops({ port }: { port: PortView }) {
  const statics = useGame((s) => s.statics);
  const list = port.workshops ?? [];
  if (!statics || list.length === 0) return null;
  return (
    <Section title={t("wsTitle")} testId="workshops">
      <p className="sub">{t("wsHint")}</p>
      <ul className="workshops">
        {list.map((w) => (
          <li key={w.recipe} data-testid={`workshop-${w.recipe}`}>
            <div className="ws-head">
              {recipeLine(statics, w.recipe, w.inputs, w.output, w.out_qty)}
              {w.stopped && <em className="tag hot">{t("wsStopped")}</em>}
              {!w.stopped && w.short && <em className="tag">{t("wsShort")}</em>}
              {w.learning && <em className="tag">{t("wsLearning")}</em>}
            </div>
            <small className="sub">
              {t("wsCapacity", {
                v: (w.daily_bp / 10_000).toFixed(1),
                pct: pct(w.capacity_bp, 0),
                share: pct(w.share_bp, 0),
              })}
              {" · "}
              {t("wsToday", { n: w.made })}
              {w.value_bp > 0 && <> · {t("wsValue", { v: (w.value_bp / 10_000).toFixed(2) })}</>}
            </small>
          </li>
        ))}
      </ul>
    </Section>
  );
}
