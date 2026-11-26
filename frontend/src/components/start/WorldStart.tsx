// 第九批开局（docs/UI-CONTRACT.md I1）：带主角名册的世界的开局流程——剧本 → 主角名册 → （自创：模板、外貌、姓名与生日）→ 启航。
// 主角名册是这一流程的门面：上面一排是各位主角的脸（加"自创"一格），下面是选中那位的大幅头像（童年 / 学院 / 出航三个年龄段可切换）
// 与小传：一句话、地区与家乡、风格与玩法、标签、难度、长项、学院、起始船、认得的海、信物与养成期的同伴。
// 开局文案的伏笔规则照旧：名册上的文字都来自数据（数据里写好了不点破人物秘密的文案），界面不额外推断。
// 经典世界的开局向导不经过这里（StartScreen 照旧）。
// 新界面（v2）：随机种子从底栏挪进启航一步的正文（底栏只留导航，手机上不折行）；v1 照旧在底栏。
import { useId, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { t, tk } from "../../i18n";
import type { InfoMode, ProtagonistCard, ScenarioCard, TemplateCard, WorldCard, WorldCatalog } from "../../ipc/types";
import { useGame } from "../../store/game";
import { useIsV2 } from "../../ui/uiMode";
import { PortraitArt } from "../portrait/PortraitArt";
import { captainPortrait } from "./captain";
import { LookStep } from "./CaptainCreator";
import { SeedBlock, SeedField } from "./SeedField";
import {
  CUSTOM_HERO,
  ageOn,
  chineseOnly,
  buildRequest,
  daysInMonth,
  defaultScenarioOf,
  portraitAt,
  portraitStages,
  shortName,
  worldSteps,
  type CustomDraft,
  type WorldStep,
} from "./worldKit";

/** 名册上头像格的边长与大头像的边长（CSS 像素）。 */
const TILE = 76;
const BIG = 288;

/** 没有头像素材时的占位（程序生成的头像按名字挑一张，不同人不同脸）。 */
function placeholderFor(key: string) {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return () => captainPortrait(h % 24);
}

/** 单选组里用方向键移动（名册、模板、世界、剧本卡片共用）。 */
function arrowMove<T extends string>(e: KeyboardEvent, keys: readonly T[], current: T | null, choose: (k: T) => void) {
  const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
  if (!delta || keys.length === 0) return;
  e.preventDefault();
  const i = current ? keys.indexOf(current) : -1;
  const next = keys[(i + delta + keys.length) % keys.length];
  choose(next);
  (e.currentTarget.querySelector(`[data-key="${CSS.escape(next)}"]`) as HTMLElement | null)?.focus();
}

// ───────────────────────────── 世界 ─────────────────────────────

/** 选世界：每个世界一张卡（名字、一句话、介绍、纪年与开局年份、打开的模块）。 */
export function WorldPicker({ catalog, chosen, onChoose }: { catalog: WorldCatalog; chosen: string | null; onChoose: (key: string) => void }) {
  const keys = catalog.worlds.map((w) => w.key);
  const headingId = useId();
  return (
    <section className="ts-section ws-worlds" aria-labelledby={headingId}>
      <h3 id={headingId} className="ts-heading">
        {t("ws.worldTitle")}
      </h3>
      <p className="ts-lead">{t("ws.worldLead")}</p>
      <div className="ws-world-list" role="radiogroup" aria-labelledby={headingId} onKeyDown={(e) => arrowMove(e, keys, chosen, onChoose)}>
        {catalog.worlds.map((w) => (
          <button
            key={w.key}
            type="button"
            role="radio"
            aria-checked={w.key === chosen}
            tabIndex={w.key === chosen || (!chosen && w.key === keys[0]) ? 0 : -1}
            data-key={w.key}
            data-testid={`world-${w.key}`}
            className={w.key === chosen ? "ws-world is-selected" : "ws-world"}
            onClick={() => onChoose(w.key)}
          >
            <span className="ws-world-name">
              {w.name}
              {/* 只有中文的世界，英文名会退回中文名：一样时不重复写 */}
              {w.name_en && w.name_en !== w.name && <small lang="en">{w.name_en}</small>}
            </span>
            <span className="ws-world-tagline">{w.tagline}</span>
            <span className="ws-world-desc">{w.description}</span>
            <span className="ws-world-facts">
              <span>{t("ws.worldYear", { era: w.era, year: w.start_year })}</span>
              <span>{t("ws.worldScenarios", { n: w.scenarios.length })}</span>
              {chineseOnly(w.languages) && <span className="ws-world-lang">{t("ws.worldZhOnly")}</span>}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ───────────────────────────── 剧本 ─────────────────────────────

function ScenarioPicker({ world, chosen, onChoose }: { world: WorldCard; chosen: string | null; onChoose: (key: string) => void }) {
  const keys = world.scenarios.map((s) => s.key);
  const headingId = useId();
  return (
    <section className="ts-section" aria-labelledby={headingId}>
      <h3 id={headingId} className="ts-heading">
        {t("startTitle")}
      </h3>
      <div className="ws-scenarios" role="radiogroup" aria-labelledby={headingId} onKeyDown={(e) => arrowMove(e, keys, chosen, onChoose)}>
        {world.scenarios.map((s) => (
          <button
            key={s.key}
            type="button"
            role="radio"
            aria-checked={s.key === chosen}
            tabIndex={s.key === chosen ? 0 : -1}
            data-key={s.key}
            data-testid={`scenario-${s.key}`}
            className={s.key === chosen ? "ws-scenario is-selected" : "ws-scenario"}
            onClick={() => onChoose(s.key)}
          >
            <span className="ws-scenario-name">{s.name}</span>
            <span className="ws-scenario-desc">{s.description}</span>
            <span className="ws-scenario-facts">
              <span>{t("ws.scenarioStart", { y: s.control_date[0], m: s.control_date[1], d: s.control_date[2] })}</span>
              {s.upbringing && <span className="ws-chip">{t("ws.upbringing")}</span>}
              {s.protagonists.length > 0 && <span className="ws-chip">{t("ws.heroes", { n: s.protagonists.length })}</span>}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ───────────────────────────── 主角名册 ─────────────────────────────

/** 难度：实心与空心的星。 */
function Stars({ n }: { n: number }) {
  const v = Math.max(0, Math.min(5, Math.round(n)));
  return (
    <span className="ws-stars" role="img" aria-label={t("ws.difficultyOf", { n: v })}>
      {"★".repeat(v)}
      <span className="ws-stars-off">{"★".repeat(5 - v)}</span>
    </span>
  );
}

/** 名册上方的一排脸。 */
function RosterStrip({
  scenario,
  chosen,
  onChoose,
  ageNow,
  labelledBy,
}: {
  scenario: ScenarioCard;
  chosen: string | null;
  onChoose: (key: string) => void;
  ageNow: (p: ProtagonistCard) => number;
  labelledBy: string;
}) {
  const keys = [...scenario.protagonists.map((p) => p.key), ...(scenario.templates.length > 0 ? [CUSTOM_HERO] : [])];
  // 只有一位可选（寰宇每张主角剧本都只有一位）时不画名册：一条大半空着的深色带没有可选的东西（X02）；下面的小传照旧
  if (keys.length < 2) return null;
  return (
    <div className="ws-strip" role="radiogroup" aria-labelledby={labelledBy} onKeyDown={(e) => arrowMove(e, keys, chosen, onChoose)}>
      {scenario.protagonists.map((p) => (
        <button
          key={p.key}
          type="button"
          role="radio"
          aria-checked={p.key === chosen}
          aria-label={`${p.name} · ${p.region}`}
          tabIndex={p.key === chosen ? 0 : -1}
          data-key={p.key}
          data-testid={`hero-${p.key}`}
          className={p.key === chosen ? "ws-tile is-selected" : "ws-tile"}
          onClick={() => onChoose(p.key)}
        >
          <PortraitArt asset={portraitAt(p, ageNow(p))} fallback={placeholderFor(p.key)} size={TILE} className="ws-tile-face" />
          <span className="ws-tile-name">{shortName(p.name)}</span>
          <span className="ws-tile-region">{p.region.split("·")[0]}</span>
        </button>
      ))}
      {scenario.templates.length > 0 && (
        <button
          type="button"
          role="radio"
          aria-checked={chosen === CUSTOM_HERO}
          tabIndex={chosen === CUSTOM_HERO ? 0 : -1}
          data-key={CUSTOM_HERO}
          data-testid="hero-custom"
          className={chosen === CUSTOM_HERO ? "ws-tile ws-tile-custom is-selected" : "ws-tile ws-tile-custom"}
          onClick={() => onChoose(CUSTOM_HERO)}
        >
          <span className="ws-tile-plus" aria-hidden>
            ＋
          </span>
          <span className="ws-tile-name">{t("ws.custom")}</span>
          <span className="ws-tile-region">{t("ws.customTemplates", { n: scenario.templates.length })}</span>
        </button>
      )}
    </div>
  );
}

/** 选中主角的大幅头像与小传。 */
function HeroDetail({ p, startAge, attrName }: { p: ProtagonistCard; startAge: number; attrName: (key: string) => string }) {
  const stages = portraitStages(p);
  const [stage, setStage] = useState<number | null>(null);
  const shownAge = stage ?? stages.find((s) => s.from_age <= startAge)?.from_age ?? stages[0]?.from_age ?? startAge;
  const asset = portraitAt(p, shownAge);
  const stageName = (i: number) => (i === 0 ? t("ws.stageChild") : i === stages.length - 1 ? t("ws.stageVoyage") : t("ws.stageAcademy"));
  return (
    <div className="ws-detail" data-testid="hero-detail" data-hero={p.key}>
      <figure className="ws-figure">
        <PortraitArt asset={asset} fallback={placeholderFor(p.key)} size={BIG} variant="full" label={p.name} className="ws-big" live />
        {stages.length > 1 && (
          <div className="ws-ages" role="group" aria-label={t("ws.ages")}>
            {stages.map((s, i) => (
              <button
                key={s.from_age}
                type="button"
                className={s.from_age === shownAge ? "ws-age is-on" : "ws-age"}
                aria-pressed={s.from_age === shownAge}
                onClick={() => setStage(s.from_age)}
              >
                {stageName(i)}
                <small>{t("ws.ageN", { n: s.from_age })}</small>
              </button>
            ))}
          </div>
        )}
      </figure>
      <div className="ws-bio">
        <h4 className="ws-name">
          {p.name}
          {p.name_en && (
            <small lang="en" className="ws-name-en">
              {p.name_en}
            </small>
          )}
        </h4>
        <p className="ws-region">
          {p.region}
          <span className="ws-dot">·</span>
          {t("ws.bornIn", { y: p.born[0], m: p.born[1], d: p.born[2], home: p.home })}
        </p>
        <p className="ws-tagline">{p.tagline}</p>
        {p.tags.length > 0 && (
          <ul className="ws-tags" aria-label={t("ws.tags")}>
            {p.tags.map((x) => (
              <li key={x} className="ws-chip">
                {x}
              </li>
            ))}
          </ul>
        )}
        <dl className="ws-facts">
          <div>
            <dt>{t("ws.style")}</dt>
            <dd>{p.style}</dd>
          </div>
          <div>
            <dt>{t("ws.playstyle")}</dt>
            <dd>{p.playstyle}</dd>
          </div>
          <div>
            <dt>{t("ws.difficulty")}</dt>
            <dd>
              <Stars n={p.difficulty} />
            </dd>
          </div>
          {p.strengths.length > 0 && (
            <div>
              <dt>{t("ws.strengths")}</dt>
              <dd>{p.strengths.map(attrName).join(t("start.listSep"))}</dd>
            </div>
          )}
          <div>
            <dt>{t("ws.academy")}</dt>
            <dd>{t("ws.academyAt", { name: p.academy.name, city: p.academy.city })}</dd>
          </div>
          <div>
            <dt>{t("ws.ship")}</dt>
            <dd>{p.start_ship}</dd>
          </div>
          {p.known.length > 0 && (
            <div>
              <dt>{t("ws.known")}</dt>
              <dd>{p.known.join(t("start.listSep"))}</dd>
            </div>
          )}
          <div>
            <dt>{t("ws.keepsake")}</dt>
            <dd>{p.keepsake}</dd>
          </div>
        </dl>
        {p.bonds.length > 0 && (
          <div className="ws-bonds">
            <h5>{t("ws.bonds")}</h5>
            <ul>
              {p.bonds.map((b) => (
                <li key={b.person}>
                  <span className="ws-bond-name">{b.name}</span>
                  <span className="ws-bond-kind">{b.kind}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/** 自创：模板卡片。 */
function TemplatePicker({ templates, chosen, onChoose }: { templates: TemplateCard[]; chosen: string | null; onChoose: (key: string) => void }) {
  const keys = templates.map((x) => x.key);
  const headingId = useId();
  return (
    <section className="ts-section" aria-labelledby={headingId}>
      <h3 id={headingId} className="ts-heading">
        {t("ws.templateTitle")}
      </h3>
      <p className="ts-lead">{t("ws.templateLead")}</p>
      <div className="ws-templates" role="radiogroup" aria-labelledby={headingId} onKeyDown={(e) => arrowMove(e, keys, chosen, onChoose)}>
        {templates.map((x) => (
          <button
            key={x.key}
            type="button"
            role="radio"
            aria-checked={x.key === chosen}
            tabIndex={x.key === chosen ? 0 : -1}
            data-key={x.key}
            data-testid={`template-${x.key}`}
            className={x.key === chosen ? "ws-template is-selected" : "ws-template"}
            onClick={() => onChoose(x.key)}
          >
            <span className="ws-template-name">{x.name}</span>
            <span className="ws-template-home">{t("ws.templateHome", { home: x.home, academy: x.academy.name })}</span>
            <span className="ws-template-line">{x.family}</span>
            <span className="ws-template-line">{x.activities}</span>
            <span className="ws-template-foot">
              <span className="ws-chip">{x.style}</span>
              {x.known.length > 0 && <span className="ws-template-known">{x.known.join(t("start.listSep"))}</span>}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** 自创：姓名、性别与生日（年份由剧本的主角生年决定，这里只选月日）。 */
function CustomNameStep({ draft, months, onChange }: { draft: CustomDraft; months: number[] | undefined; onChange: (d: CustomDraft) => void }) {
  const ids = useId();
  const days = daysInMonth(months, draft.month);
  const monthCount = months?.length ?? 12;
  return (
    <div className="ws-custom">
      <div className="ts-field">
        <label htmlFor={`${ids}-name`}>{t("ws.customName")}</label>
        <input
          id={`${ids}-name`}
          className="ts-input"
          value={draft.name}
          maxLength={24}
          aria-invalid={!draft.name.trim()}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
        />
      </div>
      <fieldset className="ts-field ws-gender">
        <legend className="ts-field-label">{t("ws.customGender")}</legend>
        {(["f", "m"] as const).map((g) => (
          <label key={g} className="ws-radio">
            <input type="radio" name={`${ids}-gender`} checked={draft.gender === g} onChange={() => onChange({ ...draft, gender: g })} />
            {tk(`ws.gender.${g}`)}
          </label>
        ))}
      </fieldset>
      <div className="ts-field ws-birthday">
        <span className="ts-field-label">{t("ws.customBirthday")}</span>
        <select aria-label={t("ws.customMonth")} value={draft.month} onChange={(e) => onChange({ ...draft, month: Number(e.target.value), day: Math.min(draft.day, daysInMonth(months, Number(e.target.value))) })}>
          {Array.from({ length: monthCount }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {t("ws.monthN", { n: i + 1 })}
            </option>
          ))}
        </select>
        <select aria-label={t("ws.customDay")} value={draft.day} onChange={(e) => onChange({ ...draft, day: Number(e.target.value) })}>
          {Array.from({ length: days }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {t("ws.dayN", { n: i + 1 })}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ───────────────────────────── 整个流程 ─────────────────────────────

export default function WorldStart({
  world,
  onBack,
  backLabel,
  attrName,
  initialCustom,
}: {
  world: WorldCard;
  /** 回到选世界（只有一个世界时不给） */
  onBack?: () => void;
  /** TITLE1：第一步返回键的字（没给时写“换个世界”） */
  backLabel?: string;
  /** 属性 key → 名字（查当前世界的属性表；没有时显示 key） */
  attrName: (key: string) => string;
  /** 自创主角的初始草稿（随机的名字与外貌，由 StartScreen 给） */
  initialCustom: CustomDraft;
}) {
  const newWorldGame = useGame((s) => s.newWorldGame);
  const v2 = useIsV2();
  const ids = useId();
  const [scenarioKey, setScenarioKey] = useState<string | null>(() => defaultScenarioOf(world)?.key ?? null);
  const scenario = world.scenarios.find((s) => s.key === scenarioKey) ?? null;
  const [hero, setHero] = useState<string | null>(() => scenario?.protagonists[0]?.key ?? (scenario?.templates.length ? CUSTOM_HERO : null));
  const [template, setTemplate] = useState<string | null>(() => scenario?.templates[0]?.key ?? null);
  const [custom, setCustom] = useState<CustomDraft>(initialCustom);
  const [seed, setSeed] = useState("");
  const [info, setInfo] = useState<InfoMode>("carried");
  const [history, setHistory] = useState(true);
  const [skip, setSkip] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const steps = useMemo(() => worldSteps(world, scenario, hero), [world, scenario, hero]);
  const step: WorldStep = steps[Math.min(stepIndex, steps.length - 1)];
  const chosenHero = scenario?.protagonists.find((p) => p.key === hero) ?? null;
  const ageNow = (p: ProtagonistCard) => (scenario ? ageOn(p.born, scenario.control_date) : 0);

  const ready = (s: WorldStep): boolean => {
    switch (s) {
      case "scenario":
        return !!scenario;
      case "hero":
        return !!hero;
      case "template":
        return !!template;
      case "name":
        return !!custom.name.trim();
      default:
        return true;
    }
  };
  const canNext = ready(step);
  const isLast = step === "confirm";

  const chooseScenario = (key: string) => {
    setScenarioKey(key);
    const s = world.scenarios.find((x) => x.key === key);
    setHero(s?.protagonists[0]?.key ?? (s?.templates.length ? CUSTOM_HERO : null));
    setTemplate(s?.templates[0]?.key ?? null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isLast) {
      if (canNext) setStepIndex((i) => Math.min(i + 1, steps.length - 1));
      return;
    }
    if (!scenario || busy || !steps.every(ready)) return;
    setBusy(true);
    const n = seed ? Number(seed) : null;
    await newWorldGame(buildRequest({ world, scenario, hero, template, custom, seed: n, skipUpbringing: skip, history, info }));
    setBusy(false);
  };

  const back = () => {
    if (stepIndex > 0) setStepIndex((i) => i - 1);
    else onBack?.();
  };

  const heroName = hero === CUSTOM_HERO ? custom.name.trim() : chosenHero?.name;

  return (
    <form className="ts-form ws-form" data-step={step} onSubmit={submit}>
      <nav className="cw-stepper" aria-label={t("ws.steps")}>
        <ol>
          {steps.map((s, i) => (
            <li key={s} className={i < stepIndex ? "is-past" : i === stepIndex ? "is-current" : undefined} aria-current={i === stepIndex ? "step" : undefined}>
              <button type="button" className="cw-stepper-btn" disabled={i > stepIndex && !steps.slice(0, i).every(ready)} onClick={() => setStepIndex(i)}>
                <span className="cw-stepper-n">{i + 1}</span>
                <span className="cw-stepper-label">{tk(`ws.step.${s}`)}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div className="ts-body">
        {step === "scenario" && <ScenarioPicker world={world} chosen={scenarioKey} onChoose={chooseScenario} />}
        {step === "hero" && scenario && (
          <section className="ts-section ws-roster" aria-labelledby={`${ids}-roster`}>
            <h3 id={`${ids}-roster`} className="ts-heading">
              {t("ws.rosterTitle")}
            </h3>
            <RosterStrip scenario={scenario} chosen={hero} onChoose={setHero} ageNow={ageNow} labelledBy={`${ids}-roster`} />
            {chosenHero ? (
              <HeroDetail key={chosenHero.key} p={chosenHero} startAge={ageNow(chosenHero)} attrName={attrName} />
            ) : hero === CUSTOM_HERO ? (
              <div className="ws-detail ws-detail-custom">
                <p className="ts-lead">{t("ws.customLead")}</p>
              </div>
            ) : null}
          </section>
        )}
        {step === "template" && scenario && <TemplatePicker templates={scenario.templates} chosen={template} onChoose={setTemplate} />}
        {step === "look" && (
          <section className="ts-section">
            <LookStep
              look={custom.look}
              onLook={(look) => setCustom({ ...custom, look })}
              onRandomLook={() => setCustom({ ...custom, look: (custom.look + 7) % 24 })}
              headingId={`${ids}-look`}
            />
          </section>
        )}
        {step === "name" && <CustomNameStep draft={custom} months={world.months} onChange={setCustom} />}
        {step === "confirm" && scenario && (
          <section className="ts-section ws-confirm" aria-labelledby={`${ids}-confirm`}>
            <h3 id={`${ids}-confirm`} className="ts-heading">
              {t("ws.confirmTitle")}
            </h3>
            <p className="ts-lead" data-testid="ws-voyage-line">
              {heroName
                ? t("ws.confirmLine", { name: heroName, scenario: scenario.name, y: scenario.start_date[0] })
                : t("ws.confirmLineNoHero", { scenario: scenario.name })}
            </p>
            {scenario.upbringing && scenario.options.skip_upbringing && (
              <label className="ws-check">
                <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
                <span>
                  {t("ws.skipUpbringing")}
                  <small>{t("ws.skipUpbringingHint")}</small>
                </span>
              </label>
            )}
            {scenario.options.history_toggle && (
              <label className="ws-check">
                <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
                <span>
                  {t("ws.history")}
                  <small>{t("ws.historyHint")}</small>
                </span>
              </label>
            )}
            <fieldset className="cw-info" data-testid="ws-info">
              <legend>{t("info.title")}</legend>
              {(["carried", "live"] as const).map((m) => (
                <label key={m} className="cw-info-opt">
                  <input type="radio" name={`${ids}-info`} value={m} checked={info === m} onChange={() => setInfo(m)} />
                  <span className="cw-info-name">{tk(`info.mode.${m}`)}</span>
                  <small>{tk(`info.mode.${m}Hint`)}</small>
                </label>
              ))}
            </fieldset>
            {v2 && <SeedBlock value={seed} onChange={setSeed} />}
          </section>
        )}
      </div>
      <footer className="ts-launch">
        <div className="ts-launch-row">
          {isLast && !v2 && <SeedField value={seed} onChange={setSeed} />}
          <div className="cw-nav">
            <button type="button" className="ts-btn" onClick={back} disabled={stepIndex === 0 && !onBack}>
              {stepIndex === 0 && onBack ? (backLabel ?? t("ws.backToWorlds")) : t("cap.prev")}
            </button>
            {isLast ? (
              <button type="submit" className="ts-btn ts-btn-go" disabled={busy || !steps.every(ready)}>
                {scenario?.upbringing && !skip ? t("ws.beginUpbringing") : t("startNew")}
              </button>
            ) : (
              <button type="submit" className="ts-btn ts-btn-next" disabled={!canNext}>
                {t("cap.next")}
              </button>
            )}
          </div>
        </div>
        {busy && (
          <p className="ts-hint" role="status">
            {t("ws.starting")}
          </p>
        )}
      </footer>
    </form>
  );
}
