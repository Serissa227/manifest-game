// 开局向导的步骤条，以及与身世有关的几步：生日、星座与年龄，身世问答（一问一页）、属性分配（含算学奇才）、启航前的汇总。
// 旧存档的补建身世（CaptainRetro）也用这几个组件。数值规则见 wizard.ts（与内核一致）。
// 属性分组的世界（UI-CONTRACT I2）：属性按组列出，每组一个可折叠的段落（组名、规则与本组剩余点数），隐藏属性不列；
// 手机竖屏上组多时改成一组一页（上面一排组名切换），不出横向滚动。经典世界（一组六项）照原来的版面画。
import { useId, useState, type ReactNode } from "react";
import { methodFull, methodName } from "../../forecast/labels";
import { GENIUS_METHODS } from "../../forecast/methods";
import { isCompact, useLayout } from "../../hooks/useViewport";
import { monthName, t, tk } from "../../i18n";
import type { StaticView } from "../../ipc/types";
import { AttrPips } from "./CaptainCard";
import { attributeEffectText, attributeName, bornText, bornYearText, effectText, numeracyPerks, signDatesText } from "./captainText";
import type { DraftApi } from "./useCaptainDraft";
import type { WizardNav } from "./useWizardNav";
import {
  AGE_PRESETS,
  attrKeys,
  birthYear,
  birthdayDays,
  groupLeft,
  groupedAttrs,
  isClassicLayout,
  monthCount,
  numeracyIndex,
  optionOf,
  signOf,
  startEffects,
  wizardOptions,
  zodiacSigns,
  type AttrBucket,
  type StepKey,
} from "./wizard";

/** 1…n。 */
function upTo(n: number): number[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => i + 1);
}

// ───────────────────────────── 步骤条 ─────────────────────────────

/** 步骤条：编号牌与步骤名；当前步 aria-current，没法去的步禁用。 */
export function Stepper({ steps, nav }: { steps: StepKey[]; nav: WizardNav }) {
  return (
    <nav className="cw-stepper" aria-label={t("cap.steps")}>
      <ol>
        {steps.map((step, i) => (
          <li key={step} className={i < nav.index ? "is-past" : i === nav.index ? "is-current" : undefined}>
            <button
              type="button"
              className="cw-stepper-btn"
              aria-current={i === nav.index ? "step" : undefined}
              disabled={i !== nav.index && !nav.reachable(i)}
              onClick={() => nav.goTo(step)}
            >
              <span className="cw-stepper-n" aria-hidden>
                {i + 1}
              </span>
              <span className="cw-stepper-label">{tk(`cap.step.${step}`)}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ───────────────────────────── 生日、星座与年龄 ─────────────────────────────

/** 年龄：滑块、−/+、常用年龄的快捷按钮（只列允许范围之内的），旁边实时写出出生年份。 */
function AgePicker({ api, startYear, era }: { api: DraftApi; startYear: number; era?: string }) {
  const uid = useId();
  const { defs, draft } = api;
  const p = defs.points;
  const presets = AGE_PRESETS.filter((a) => a >= p.age_min && a <= p.age_max);
  return (
    <div className="cw-age" role="group" aria-labelledby={`${uid}-age`}>
      <div className="cw-age-row">
        <span id={`${uid}-age`} className="ts-field-label">
          {t("cap.bd.age")}
        </span>
        <button
          type="button"
          className="ts-btn ts-btn-arrow cw-step-btn"
          aria-label={t("cap.bd.younger")}
          disabled={draft.age <= p.age_min}
          onClick={() => api.setAge(draft.age - 1)}
        >
          −
        </button>
        <input
          type="range"
          className="cw-age-slider"
          min={p.age_min}
          max={Math.max(p.age_min, p.age_max)}
          step={1}
          value={draft.age}
          aria-label={t("cap.bd.age")}
          aria-valuetext={t("cap.bd.ageText", { age: draft.age })}
          onChange={(e) => api.setAge(Number(e.target.value))}
        />
        <button
          type="button"
          className="ts-btn ts-btn-arrow cw-step-btn"
          aria-label={t("cap.bd.older")}
          disabled={draft.age >= p.age_max}
          onClick={() => api.setAge(draft.age + 1)}
        >
          +
        </button>
        <output className="cw-bd-age-value ts-num" aria-live="polite">
          {t("cap.bd.ageValue", { age: draft.age })}
        </output>
      </div>
      <div className="cw-age-row">
        <div className="cw-age-quick" role="group" aria-label={t("cap.bd.ageQuick")}>
          {presets.map((a) => (
            <button
              key={a}
              type="button"
              className="ts-btn ts-btn-small cw-age-chip"
              aria-pressed={draft.age === a}
              aria-label={t("cap.bd.agePick", { age: a })}
              onClick={() => api.setAge(a)}
            >
              {a}
            </button>
          ))}
        </div>
        <span className="cw-age-born ts-num" data-testid="cw-born-year">
          {bornYearText(era, birthYear(startYear, draft.age))}
        </span>
      </div>
    </div>
  );
}

export function BirthdayStep({ api, startYear, era }: { api: DraftApi; startYear: number; era?: string }) {
  const { defs, draft } = api;
  const p = defs.points;
  const sign = signOf(defs, draft.month, draft.day);
  return (
    <div className="cw-birthday">
      <p className="ts-lead">{t("cap.lead.birthday")}</p>
      {/* 十二星座：点一个就把生日设到它的头一天；月与日改了，选中的星座随之变 */}
      <div className="cw-signs" role="radiogroup" aria-label={t("cap.bd.signs")}>
        {zodiacSigns(defs).map((s) => {
          const dates = signDatesText(s);
          const checked = s.key === sign?.key;
          return (
            <label key={s.key} className={checked ? "cw-sign is-selected" : "cw-sign"}>
              <input
                type="radio"
                name="cw-sign"
                className="ts-sr"
                checked={checked}
                aria-label={t("cap.bd.signOption", { sign: s.name, dates })}
                onChange={() => api.setBirthday({ month: s.start[0], day: s.start[1] })}
              />
              <span className="cw-sign-name">{s.name}</span>
              <span className="cw-sign-dates">{dates}</span>
              <span className="cw-sign-bonus">{t("cap.bd.signBonus", { attr: attributeName(defs, s.attribute) })}</span>
            </label>
          );
        })}
      </div>

      <div className="cw-bd-row">
        <div className="cw-bd-date" role="group" aria-label={t("cap.bd.date")}>
          <span className="ts-field-label" aria-hidden>
            {t("cap.bd.date")}
          </span>
          <select
            className="ts-input"
            aria-label={t("cap.bd.month")}
            value={draft.month}
            onChange={(e) => api.setBirthday({ month: Number(e.target.value) })}
          >
            {upTo(monthCount()).map((m) => (
              <option key={m} value={m}>
                {monthName(m) ?? tk(`month.${m}`)}
              </option>
            ))}
          </select>
          <select
            className="ts-input"
            aria-label={t("cap.bd.day")}
            value={draft.day}
            onChange={(e) => api.setBirthday({ day: Number(e.target.value) })}
          >
            {upTo(birthdayDays(draft.month)).map((d) => (
              <option key={d} value={d}>
                {t("cap.bd.dayValue", { day: d })}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="ts-btn ts-btn-small cw-random" aria-label={t("cap.bd.random")} onClick={api.randomBirthday}>
          {t("start.random")}
        </button>
      </div>

      <AgePicker api={api} startYear={startYear} era={era} />

      {sign && (
        <div className="cw-sign-card" data-testid="cw-sign-card">
          <div className="cw-sign-card-head">
            <strong className="cw-sign-card-name">{sign.name}</strong>
            <span className="cw-sign-card-dates">{signDatesText(sign)}</span>
          </div>
          <p className="cw-sign-card-desc">{sign.desc}</p>
          <ul className="cw-sign-card-perks">
            <li>{t("cap.bd.signBonus", { attr: attributeName(defs, sign.attribute) })}</li>
            {p.birthday_morale > 0 && <li>{t("cap.bd.gift", { n: p.birthday_morale })}</li>}
          </ul>
          <p className="cw-born">{bornText(era, birthYear(startYear, draft.age), draft.month, draft.day)}</p>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── 身世问答 ─────────────────────────────

export function BackgroundStep({ api, qi, statics }: { api: DraftApi; qi: number; statics: StaticView | null }) {
  const uid = useId();
  const { defs, draft } = api;
  const q = defs.questions[qi];
  if (!q) return null;
  const chosen = optionOf(defs, qi, draft.answers[qi]);
  return (
    <div className="cw-question">
      <div className="cw-q-head">
        <ol className="cw-q-dots" aria-label={t("cap.bg.progress", { n: qi + 1, total: defs.questions.length })}>
          {defs.questions.map((x, i) => (
            <li key={x.key} className={[i === qi ? "is-current" : "", draft.answers[i] ? "is-done" : ""].filter(Boolean).join(" ")} />
          ))}
        </ol>
        <span className="cw-q-count" aria-hidden>
          {t("cap.bg.progress", { n: qi + 1, total: defs.questions.length })}
        </span>
        <button type="button" className="ts-btn ts-btn-small cw-random" aria-label={t("cap.bg.random")} onClick={() => api.randomAnswer(qi)}>
          {t("start.random")}
        </button>
      </div>
      <p className="ts-lead cw-q-prompt">{q.prompt}</p>
      <div className="cw-options" role="radiogroup" aria-label={q.title}>
        {wizardOptions(defs, qi).map((o) => (
          <label key={o.key} className={chosen?.key === o.key ? "cw-option is-selected" : "cw-option"}>
            <input
              type="radio"
              name={`cw-q-${q.key}`}
              className="ts-sr"
              checked={chosen?.key === o.key}
              aria-label={o.name}
              aria-describedby={`${uid}-${o.key}`}
              onChange={() => api.answer(qi, o.key)}
            />
            <span className="cw-opt-name">{o.name}</span>
            <span className="cw-opt-tags" id={`${uid}-${o.key}`}>
              {o.attrs.map(([k, v]) => (
                <span key={k} className="cw-tag">
                  {t("cap.bg.attr", { name: attributeName(defs, k), n: v })}
                </span>
              ))}
              {o.effect && <span className="cw-tag is-effect">{effectText(o.effect, statics)}</span>}
            </span>
          </label>
        ))}
      </div>
      {chosen ? (
        <blockquote className="cw-opt-text" data-testid="cw-option-text">
          {chosen.text}
        </blockquote>
      ) : (
        <p className="ts-hint">{t("cap.bg.pick")}</p>
      )}
    </div>
  );
}

// ───────────────────────────── 属性 ─────────────────────────────

/** 属性分配：经典世界照原来的版面（一组六项），属性分组的世界按组画。 */
export function AttributesStep({ api }: { api: DraftApi }) {
  return isClassicLayout(api.defs) ? <ClassicAttributes api={api} /> : <GroupedAttributes api={api} />;
}

/** 剩余点数、随机分配与重新分配（两种版面共用）。 */
function AllocBar({ api }: { api: DraftApi }) {
  const { alloc, left } = api;
  return (
    <div className="cw-at-bar">
      <strong className={left > 0 ? "cw-left" : "cw-left is-done"} role="status" data-testid="cw-points-left">
        {t("cap.at.left", { n: left })}
      </strong>
      <span className="cw-at-actions">
        <button type="button" className="ts-btn ts-btn-small" onClick={api.randomAlloc}>
          {t("cap.at.random")}
        </button>
        <button type="button" className="ts-btn ts-btn-small" onClick={api.resetAlloc} disabled={alloc.every((v) => v === 0)}>
          {t("cap.at.reset")}
        </button>
      </span>
    </div>
  );
}

/** 一项属性：名字与说明、− 格子 读数 +、效果。组里没有自由点数时只读（不画 − +）；取值范围宽的组画成横条。 */
function AttrRow({ api, i, bucket }: { api: DraftApi; i: number; bucket: AttrBucket }) {
  const { defs, attrs, alloc, bg } = api;
  const k = attrKeys(defs)[i];
  const a = defs.attributes[i];
  const name = a?.name ?? k;
  const v = attrs[i] ?? 0;
  const g = bucket.group;
  const perks = k === "numeracy" ? numeracyPerks(defs, v, true) : [];
  const fx = [attributeEffectText(k, v), ...perks].filter(Boolean);
  const fixed = g.free <= 0;
  const [lo, hi] = g.range;
  const wide = hi - lo > PIP_LIMIT;
  const meter = t("cap.at.meter", { name, value: v, base: bg[i], alloc: alloc[i] });
  return (
    <li className={fixed ? "cw-attr is-fixed" : "cw-attr"} data-attr={k}>
      <div className="cw-attr-head">
        <strong>{name}</strong>
        <span className="cw-attr-desc">{a?.desc}</span>
      </div>
      <div className="cw-attr-ctrl">
        {!fixed && (
          <button type="button" className="ts-btn ts-btn-arrow cw-step-btn" aria-label={t("cap.at.dec", { name })} disabled={!api.canDec(i)} onClick={() => api.dec(i)}>
            −
          </button>
        )}
        {wide ? (
          <span className="cw-attr-meter" aria-hidden>
            <i style={{ width: `${Math.round(hi > lo ? ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 100 : 0)}%` }} />
          </span>
        ) : (
          <AttrPips value={v} alloc={alloc[i]} cap={g.creation_cap} max={hi} />
        )}
        <output className="cw-attr-num ts-num" aria-label={meter}>
          {v}
        </output>
        {!fixed && (
          <button type="button" className="ts-btn ts-btn-arrow cw-step-btn" aria-label={t("cap.at.inc", { name })} disabled={!api.canInc(i)} onClick={() => api.inc(i)}>
            +
          </button>
        )}
      </div>
      {fx.length > 0 && <p className="cw-attr-fx">{fx.join(tk("start.factSep"))}</p>}
    </li>
  );
}

/** 取值范围超过这么多格时不画格子，画横条（如 0–100 的品行）。 */
const PIP_LIMIT = 12;

/** 算学的提示与奇才之法（世界有算学这一项时）。 */
function GeniusBlock({ api }: { api: DraftApi }) {
  const { defs, attrs } = api;
  const p = defs.points;
  const ni = numeracyIndex(defs);
  if (ni < 0) return null;
  const numeracy = attrs[ni] ?? 0;
  return (
    <>
      <p className="ts-hint cw-numeracy-tip">
        {t("cap.at.numeracyTip", { manual: p.manual_numeracy, learn: p.learn_numeracy, days: p.learn_days, genius: p.genius_numeracy })}
      </p>
      {api.genius ? (
        <fieldset className="cw-genius" data-testid="cw-genius">
          <legend>{t("cap.gn.title")}</legend>
          <p className="cw-genius-lead">{t("cap.gn.lead", { n: numeracy })}</p>
          <div className="cw-genius-list" role="radiogroup" aria-label={t("cap.gn.choice")}>
            {GENIUS_METHODS.map((m) => (
              <label key={m} className={api.method === m ? "cw-genius-item is-selected" : "cw-genius-item"}>
                <input type="radio" name="cw-genius" className="ts-sr" checked={api.method === m} aria-label={methodFull(m)} onChange={() => api.setMethod(m)} />
                <strong>{methodName(m)}</strong>
                <small>{tk(`fc.mm.${m}`)}</small>
                <span>{tk(`fc.md.${m}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="ts-hint cw-genius-locked">{t("cap.gn.locked", { n: p.genius_numeracy })}</p>
      )}
    </>
  );
}

/** 经典世界：一组六项（与第九批之前逐 DOM 相同）。 */
function ClassicAttributes({ api }: { api: DraftApi }) {
  const bucket = groupedAttrs(api.defs)[0];
  const g = bucket.group;
  const { defs, attrs, alloc, bg } = api;
  const keys = attrKeys(defs);
  return (
    <div className="cw-attrs-step">
      <p className="ts-lead">{t("cap.lead.attrs", { free: g.free, cap: g.creation_cap })}</p>
      <AllocBar api={api} />
      <ul className="cw-attr-list">
        {bucket.items.map((i) => {
          const k = keys[i];
          const a = defs.attributes.find((x) => x.key === k);
          const name = a?.name ?? k;
          const v = attrs[i] ?? 0;
          const perks = k === "numeracy" ? numeracyPerks(defs, v, true) : [];
          return (
            <li key={k} className="cw-attr">
              <div className="cw-attr-head">
                <strong>{name}</strong>
                <span className="cw-attr-desc">{a?.desc}</span>
              </div>
              <div className="cw-attr-ctrl">
                <button type="button" className="ts-btn ts-btn-arrow cw-step-btn" aria-label={t("cap.at.dec", { name })} disabled={!api.canDec(i)} onClick={() => api.dec(i)}>
                  −
                </button>
                <AttrPips value={v} alloc={alloc[i]} cap={g.creation_cap} max={g.range[1]} />
                <output className="cw-attr-num ts-num" aria-label={t("cap.at.meter", { name, value: v, base: bg[i], alloc: alloc[i] })}>
                  {v}
                </output>
                <button type="button" className="ts-btn ts-btn-arrow cw-step-btn" aria-label={t("cap.at.inc", { name })} disabled={!api.canInc(i)} onClick={() => api.inc(i)}>
                  +
                </button>
              </div>
              <p className="cw-attr-fx">{[attributeEffectText(k, v), ...perks].join(tk("start.factSep"))}</p>
            </li>
          );
        })}
      </ul>
      <GeniusBlock api={api} />
    </div>
  );
}

/** 一组的标题：组名、规则（自由点数、开局上限与取值范围）与本组的剩余点数。 */
function GroupHead({ api, bucket }: { api: DraftApi; bucket: AttrBucket }) {
  const g = bucket.group;
  const left = groupLeft(api.defs, api.alloc, bucket.index);
  return (
    <>
      <span className="cw-group-name">{g.name}</span>
      <span className="cw-group-rule">
        {g.free > 0 ? t("cap.at.groupRule", { free: g.free, cap: g.creation_cap, min: g.range[0], max: g.range[1] }) : t("cap.at.groupFixed")}
      </span>
      {g.free > 0 && (
        <span className={left > 0 ? "cw-group-left" : "cw-group-left is-done"} data-testid={`cw-group-left-${g.key}`}>
          {left > 0 ? t("cap.at.groupLeft", { n: left }) : t("cap.at.groupDone")}
        </span>
      )}
    </>
  );
}

/**
 * 属性分组的世界：每组一段（标题可以折叠）；手机竖屏上组多时一组一页，上面一排组名切换（带本组剩余点数）。
 * 隐藏属性不列，只有隐藏属性的组整组不列。
 */
function GroupedAttributes({ api }: { api: DraftApi }) {
  const uid = useId();
  const paged = isCompact(useLayout());
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const [page, setPage] = useState(0);
  const buckets = groupedAttrs(api.defs).filter((b) => b.items.length > 0);
  const tabs = paged && buckets.length > 1;
  const cur = Math.min(page, Math.max(0, buckets.length - 1));
  const shown = tabs ? buckets.slice(cur, cur + 1) : buckets;
  const toggle = (key: string) => {
    const next = new Set(folded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setFolded(next);
  };
  return (
    <div className="cw-attrs-step cw-attrs-grouped">
      <p className="ts-lead">{t("cap.lead.attrsGroups")}</p>
      <AllocBar api={api} />
      {tabs && (
        <div className="cw-group-tabs" role="tablist" aria-label={t("cap.at.groups")}>
          {buckets.map((b, i) => {
            const left = groupLeft(api.defs, api.alloc, b.index);
            return (
              <button
                key={b.group.key}
                type="button"
                role="tab"
                id={`${uid}-tab-${b.group.key}`}
                aria-selected={i === cur}
                aria-controls={`${uid}-group-${b.group.key}`}
                className={i === cur ? "cw-group-tab is-on" : "cw-group-tab"}
                onClick={() => setPage(i)}
              >
                {b.group.name}
                {left > 0 && <span className="cw-group-badge">{left}</span>}
              </button>
            );
          })}
        </div>
      )}
      {shown.map((b) => {
        const open = tabs || !folded.has(b.group.key);
        const bodyId = `${uid}-group-${b.group.key}`;
        return (
          <section
            key={b.group.key}
            className={open ? "cw-group" : "cw-group is-folded"}
            data-group={b.group.key}
            aria-label={b.group.name}
            id={tabs ? bodyId : undefined}
            role={tabs ? "tabpanel" : undefined}
            aria-labelledby={tabs ? `${uid}-tab-${b.group.key}` : undefined}
          >
            {tabs ? (
              <div className="cw-group-head">
                <GroupHead api={api} bucket={b} />
              </div>
            ) : (
              <button type="button" className="cw-group-head cw-group-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => toggle(b.group.key)}>
                <span className="cw-group-caret" aria-hidden>
                  {open ? "▾" : "▸"}
                </span>
                <GroupHead api={api} bucket={b} />
              </button>
            )}
            {open && (
              <ul className="cw-attr-list" id={tabs ? undefined : bodyId}>
                {b.items.map((i) => (
                  <AttrRow key={i} api={api} i={i} bucket={b} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
      <GeniusBlock api={api} />
    </div>
  );
}

// ───────────────────────────── 汇总 ─────────────────────────────

export type SummaryEdit = "birthday" | "background" | "attrs";

/** 启航前（或补建身世）的汇总：生辰、身世、属性、奇才之法与开局效果；每项可跳回修改。 */
export function DraftSummary({
  api,
  statics,
  startYear,
  withEffects,
  onEdit,
  children,
}: {
  api: DraftApi;
  statics: StaticView | null;
  startYear: number;
  /** 列出开局效果（补建身世时不发放，不列） */
  withEffects: boolean;
  onEdit?: (step: SummaryEdit) => void;
  /** 放在最前面的行（剧本等） */
  children?: ReactNode;
}) {
  const { defs, draft, attrs } = api;
  const keys = attrKeys(defs);
  const sign = signOf(defs, draft.month, draft.day);
  const effects = startEffects(defs, draft.answers);
  const edit = (step: SummaryEdit) =>
    onEdit && (
      <button type="button" className="cw-edit" onClick={() => onEdit(step)}>
        {t("cap.cf.edit", { step: tk(`cap.step.${step}`) })}
      </button>
    );
  return (
    <dl className="cw-summary" data-testid="cw-summary">
      {children}
      <div className="cw-summary-row">
        <dt>{t("cap.cf.born")}</dt>
        <dd>
          {bornText(statics?.world?.era, birthYear(startYear, draft.age), draft.month, draft.day)}
          {sign && <span className="cw-card-sign">{sign.name}</span>}
        </dd>
        {edit("birthday")}
      </div>
      <div className="cw-summary-row">
        <dt>{t("cap.cf.background")}</dt>
        <dd>{draft.answers.map((a, qi) => optionOf(defs, qi, a)?.name ?? t("cap.card.unanswered")).join(tk("start.factSep"))}</dd>
        {edit("background")}
      </div>
      <div className="cw-summary-row">
        <dt>{t("cap.cf.attrs")}</dt>
        {isClassicLayout(defs) ? (
          <dd>
            {groupedAttrs(defs)[0]
              .items.map((i) => t("cap.card.attr", { name: attributeName(defs, keys[i]), value: attrs[i] ?? 0 }))
              .join(tk("start.factSep"))}
          </dd>
        ) : (
          <dd className="cw-summary-groups">
            {groupedAttrs(defs)
              .filter((b) => b.items.length > 0)
              .map((b) => (
                <span key={b.group.key} className="cw-summary-group">
                  {t("cap.cf.groupAttrs", {
                    group: b.group.name,
                    list: b.items.map((i) => t("cap.card.attr", { name: attributeName(defs, keys[i]), value: attrs[i] ?? 0 })).join(tk("start.listSep")),
                  })}
                </span>
              ))}
          </dd>
        )}
        {edit("attrs")}
      </div>
      {api.method && (
        <div className="cw-summary-row">
          <dt>{t("cap.cf.genius")}</dt>
          <dd>{methodFull(api.method)}</dd>
        </div>
      )}
      {withEffects && (
        <div className="cw-summary-row">
          <dt>{t("cap.cf.effects")}</dt>
          <dd>{effects.length > 0 ? effects.map((e) => effectText(e, statics)).join(tk("start.listSep")) : t("cap.cf.noEffects")}</dd>
        </div>
      )}
    </dl>
  );
}
