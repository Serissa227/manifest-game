// 养成主画面的左栏：主角（按年龄与季节换装的立绘）、姓名与年龄、体力 / 疲劳 / 心情 / 名声四条数值、评价的段位。
import { t, tk } from "../../i18n";
import type { Meter, UpbringingView } from "../../ipc/types";
import { PortraitArt } from "../portrait/PortraitArt";
import { captainPortrait } from "../start/captain";
import { tz } from "../../i18n/zhOnly";
import { meterTone } from "./ubKit";

const PORTRAIT = 248;

function Bar({ kind, m }: { kind: "stamina" | "fatigue" | "mood" | "fame"; m: Meter }) {
  const pct = m.max > 0 ? Math.max(0, Math.min(100, Math.round((m.value / m.max) * 100))) : 0;
  // U04：心情条悬停写清回落、兴致与低谷的门槛；兴致高、低谷时在数值后加一个小标
  const moodRules = kind === "mood" && m.center != null && m.high != null && m.low != null;
  const tip = moodRules
    ? tz("ub.mood.tip", { center: m.center ?? 0, high: m.high ?? 0, low: m.low ?? 0, bonus: m.high_bonus_pct ?? 0 })
    : undefined;
  return (
    <div className={`ub-meter ub-meter--${meterTone(kind, m)}`} data-testid={`meter-${kind}`} title={tip}>
      <span className="ub-meter-name">{tk(`ub.meter.${kind}`)}</span>
      <span className="ub-meter-track" role="meter" aria-valuemin={0} aria-valuemax={m.max} aria-valuenow={m.value} aria-label={tk(`ub.meter.${kind}`)}>
        <span className="ub-meter-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="ub-meter-label">{m.label}</span>
      {moodRules && m.boosted && <span className="ub-meter-tag is-good">{tz("ub.mood.boosted", { bonus: m.high_bonus_pct ?? 0 })}</span>}
      {moodRules && m.low_mood && <span className="ub-meter-tag is-cost">{tz("ub.mood.low")}</span>}
    </div>
  );
}

export function UbHero({ view }: { view: UpbringingView }) {
  const p = view.protagonist;
  return (
    <aside className="ub-hero" aria-label={t("ub.hero")}>
      <figure className="ub-hero-figure">
        <PortraitArt asset={p.portrait} fallback={() => captainPortrait(0)} size={PORTRAIT} variant="full" label={p.name} className="ub-hero-portrait" live />
        <figcaption className="ub-hero-plate">
          <span className="ub-hero-name">{p.name}</span>
          <span className="ub-hero-age">
            {t("ub.age", { n: p.age })}
            <span className="ub-dot">·</span>
            {t("ub.birthday", { m: p.birthday[0], d: p.birthday[1] })}
          </span>
        </figcaption>
      </figure>
      <div className="ub-meters">
        <Bar kind="stamina" m={view.meters.stamina} />
        <Bar kind="fatigue" m={view.meters.fatigue} />
        <Bar kind="mood" m={view.meters.mood} />
        <Bar kind="fame" m={view.meters.fame} />
      </div>
      {view.ratings.length > 0 && (
        <ul className="ub-ratings" aria-label={t("ub.ratings")}>
          {view.ratings.map((r) => (
            <li key={r.key} className="ub-rating" data-rating={r.key}>
              <span className="ub-rating-name">{r.name}</span>
              <span className="ub-rating-rank">{r.rank}</span>
              <span className="ub-rating-value">{r.value}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="ub-cash" data-testid="ub-cash">
        {t("ub.cash", { v: view.cash })}
      </p>
    </aside>
  );
}
