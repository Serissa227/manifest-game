// 养成主画面的右栏：分页——属性（按组的成长值条与结业时的预计、技能）、羁绊（同伴：情谊、心动、称呼、生日、喜好、去向）、
// 日历（节日 ♡、考试、比赛、生日、校历、来信的倒计时）、相册（回忆）、书信、日记、志向与考试。
// 空着的分页用共用的空状态（EmptyState）：新界面（v2）画成浅底虚线框，旧界面照旧是原来的一行 .ub-empty；
// v2 下“志向”分页里还没有志向可选、没有考试时也写一句，不留两块空白。
import { useState } from "react";
import { publicImage } from "../../art/imageUrl";
import { t, tk } from "../../i18n";
import type { CaptainDefsView, CompanionView, SkillEffectLine, SkillEffectsView, UpbringingView } from "../../ipc/types";
import { tz } from "../../i18n/zhOnly";
import { useIsV2 } from "../../ui/uiMode";
import { EmptyState } from "../feedback";
import { PortraitArt } from "../portrait/PortraitArt";
import { captainPortrait } from "../start/captain";
import { SIDE_TABS, growthRatio, sceneArtPath, upcoming, type SideTab } from "./ubKit";
import { shownWhere } from "../shownText";

/** 分页空着时的一句话（v1 照旧画 <p className="ub-empty">）。 */
function UbEmpty({ text }: { text: string }) {
  return <EmptyState text={text} className="ub-empty-state" v1={<p className="ub-empty">{text}</p>} />;
}

function face(key: string) {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return () => captainPortrait(h % 24);
}

/** 属性：按组（资质、本领、品行……）列出成长值条；组与名字来自世界的属性表（StaticView.captain）。 */
function Attrs({ view, defs, attrName }: { view: UpbringingView; defs: CaptainDefsView | null | undefined; attrName: (k: string) => string }) {
  const groups = defs?.groups ?? [];
  const groupOf = (k: string) => defs?.attributes.find((a) => a.key === k)?.group ?? "";
  const buckets: { key: string; name: string; items: UpbringingView["growth"] }[] =
    groups.length > 0
      ? groups.map((g) => ({ key: g.key, name: g.name, items: view.growth.filter((x) => groupOf(x.attr) === g.key) })).filter((b) => b.items.length > 0)
      : [{ key: "all", name: "", items: view.growth }];
  return (
    <div className="ub-attrs">
      {buckets.map((b) => (
        <section key={b.key} className="ub-attr-group" aria-label={b.name || t("ub.tab.attrs")}>
          {b.name && <h4>{b.name}</h4>}
          <ul>
            {b.items.map((g) => (
              <li key={g.attr} className="ub-attr" data-attr={g.attr}>
                <span className="ub-attr-name">{attrName(g.attr)}</span>
                <span className="ub-attr-track" role="meter" aria-valuemin={0} aria-valuemax={1000} aria-valuenow={g.value} aria-label={attrName(g.attr)}>
                  <span style={{ width: `${Math.round(growthRatio(g.value) * 100)}%` }} />
                </span>
                <span className="ub-attr-proj" title={t("ub.projected")}>
                  {g.projected}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {view.skills.length > 0 && (
        <section className="ub-attr-group">
          <h4>{t("ub.skills")}</h4>
          <ul className="ub-skills">
            {view.skills.map((s) => (
              <li key={s.key}>
                <span>{s.name}</span>
                <span className="ub-skill-lv">{t("ub.skillLv", { n: s.level })}</span>
                <span className="ub-skill-xp">{t("ub.skillXp", { xp: s.xp, next: s.next })}</span>
                {s.effects && <SkillFx fx={s.effects} />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** K01：技能效果占技能行下面一行：“生效 发现物探查 +6%”深色，“3 级 +9%”浅色；被叠加上限压住、暂无作用、世界没开的写在后面。 */
function SkillFx({ fx }: { fx: SkillEffectsView }) {
  const note = (e: SkillEffectLine) => {
    if (!fx.enabled) return tz("ub.skillFx.off");
    if (!e.live) return tz("ub.skillFx.inert");
    if (e.capped !== null) return tz("ub.skillFx.capped", { v: `${e.capped}${e.kind.endsWith("_pct") ? "%" : ""}` });
    return null;
  };
  const lines = (list: SkillEffectLine[], now: boolean) =>
    list.map((e) => {
      const n = note(e);
      return (
        <span key={e.kind} className="ub-skill-fx-item" data-live={now && fx.enabled && e.live ? "1" : undefined}>
          {e.text}
          {n && <em className="ub-skill-fx-note">（{n}）</em>}
        </span>
      );
    });
  return (
    <span className="ub-skill-fx">
      {fx.now.length > 0 && (
        <span className="ub-skill-fx-now">
          <b>{tz("ub.skillFx.now")}</b>
          {lines(fx.now, true)}
        </span>
      )}
      {fx.next_level !== null && fx.next.length > 0 && (
        <span className="ub-skill-fx-next">
          <b>{fx.now.length > 0 ? tz("ub.skillFx.next", { n: fx.next_level }) : tz("ub.skillFx.first")}</b>
          {lines(fx.next, false)}
        </span>
      )}
    </span>
  );
}

/** 心动的三阶：在意、心动、心照不宣（只在开放的人之间显示）。 */
function Heart({ c }: { c: CompanionView }) {
  if (!c.romance_open || c.heart === null || c.heart_stage === null) return null;
  return (
    <span className="ub-heart" aria-label={tk(`ub.heart.${c.heart_stage}`)} title={tk(`ub.heart.${c.heart_stage}`)}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= c.heart_stage! ? "is-on" : undefined}>
          ♥
        </span>
      ))}
    </span>
  );
}

function Bonds({ view }: { view: UpbringingView }) {
  return (
    <ul className="ub-bonds">
      {view.companions.map((c) => (
        <li key={c.key} className="ub-bond" data-person={c.key}>
          <PortraitArt asset={c.portrait} fallback={face(c.key)} size={56} className="ub-bond-face" />
          <div className="ub-bond-body">
            <p className="ub-bond-head">
              <span className="ub-bond-name">{c.name}</span>
              <span className="ub-bond-role">{tk(`ub.role.${c.role}`)}</span>
              {c.bond && <span className={`ub-rank ub-rank-${c.bond}`}>{c.bond}</span>}
              <Heart c={c} />
            </p>
            {c.summary && <p className="ub-bond-summary">{c.summary}</p>}
            <span className="ub-aff" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.affinity} aria-label={t("ub.affinityOf", { name: c.name })}>
              <span style={{ width: `${Math.max(0, Math.min(100, c.affinity))}%` }} />
            </span>
            <p className="ub-bond-line">
              {c.relation.length > 0 && <span>{c.relation.join("、")}</span>}
              <span>{t("ub.callsYou", { name: c.call_name })}</span>
              <span>{c.days_to_birthday <= 30 ? t("ub.birthdaySoon", { n: c.days_to_birthday }) : t("ub.birthdayOn", { m: c.birthday[0], d: c.birthday[1] })}</span>
            </p>
            {(c.likes_known.length > 0 || shownWhere(c.where_now)) && (
              <p className="ub-bond-line ub-bond-sub">
                {c.likes_known.length > 0 && <span>{t("ub.likes", { list: c.likes_known.join("、") })}</span>}
                {shownWhere(c.where_now) && <span>{t("ub.whereNow", { place: shownWhere(c.where_now) ?? "" })}</span>}
              </p>
            )}
            {c.next_hint && <p className="ub-bond-hint">{c.next_hint}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Calendar({ view }: { view: UpbringingView }) {
  const marks = upcoming(view.calendar, 30);
  if (marks.length === 0) return <UbEmpty text={t("ub.calendarEmpty")} />;
  return (
    <ul className="ub-cal">
      {marks.map((m) => (
        <li key={`${m.kind}:${m.key}:${m.date.join("-")}`} className={`ub-cal-item ub-cal--${m.kind}`}>
          <span className="ub-cal-days">{m.days_left === 0 ? t("ub.today") : t("ub.daysLeft", { n: m.days_left })}</span>
          <span className="ub-cal-name">
            {m.heart && <span className="ub-cal-heart">♡</span>}
            {m.name}
          </span>
          <span className="ub-cal-kind">{tk(`ub.mark.${m.kind}`)}</span>
          {m.note && <span className="ub-cal-note">{m.note}</span>}
        </li>
      ))}
    </ul>
  );
}

/** 回忆的缩略画（养成事件的插画：回忆插画或活动场景，按那一天的月份挑季节版）；没有图时照旧是一块底色。 */
function MemoryArt({ art, month }: { art: string | null; month: number }) {
  const src = art ? sceneArtPath(art, "small", month) : null;
  if (!src) return <span className="ub-memory-art" aria-hidden />;
  return (
    <span className="ub-memory-art has-art" aria-hidden>
      <img src={publicImage(src)} alt="" decoding="async" loading="lazy" draggable={false} data-testid="memory-art" />
    </span>
  );
}

function Album({ view }: { view: UpbringingView }) {
  if (view.memories.length === 0) return <UbEmpty text={t("ub.albumEmpty")} />;
  return (
    <ul className="ub-album">
      {view.memories.map((m) => (
        <li key={m.key} className="ub-memory">
          <MemoryArt art={m.art} month={m.date[1]} />
          <span className="ub-memory-title">{m.title}</span>
          <span className="ub-memory-date">{t("ub.dateYmd", { y: m.date[0], m: m.date[1], d: m.date[2] })}</span>
          <span className="ub-memory-line">{m.line}</span>
        </li>
      ))}
    </ul>
  );
}

function Letters({ view }: { view: UpbringingView }) {
  const [open, setOpen] = useState<string | null>(null);
  if (view.letters.length === 0) return <UbEmpty text={t("ub.lettersEmpty")} />;
  return (
    <ul className="ub-letters">
      {view.letters.map((l) => (
        <li key={l.key} className={l.read ? "ub-letter" : "ub-letter is-new"}>
          <button type="button" className="ub-letter-head" aria-expanded={open === l.key} onClick={() => setOpen(open === l.key ? null : l.key)}>
            <span className="ub-letter-from">{l.from_name}</span>
            <span className="ub-letter-title">{l.title}</span>
            <span className="ub-letter-date">{t("ub.letterDates", { sy: l.sent[0], sm: l.sent[1], ay: l.arrived[0], am: l.arrived[1] })}</span>
            {l.ai && <span className="ub-ai-mark" title={t("ub.aiWritten")} aria-label={t("ub.aiWritten")} />}
          </button>
          {open === l.key && <p className="ub-letter-body">{l.body}</p>}
        </li>
      ))}
    </ul>
  );
}

function Diary({ view }: { view: UpbringingView }) {
  if (view.diary.length === 0) return <UbEmpty text={t("ub.diaryEmpty")} />;
  return (
    <ol className="ub-diary">
      {[...view.diary].reverse().map((d) => (
        <li key={d.month.join("-")}>
          <h5>
            {t("ub.month", { y: d.month[0], m: d.month[1] })}
            {d.ai && <span className="ub-ai-mark" title={t("ub.aiWritten")} aria-label={t("ub.aiWritten")} />}
          </h5>
          <p>{d.text}</p>
        </li>
      ))}
    </ol>
  );
}

/** U04：年度目标卡——今年的三张（进度、奖励），往年的记一行。没完成不罚。 */
function Goals({ goals }: { goals: NonNullable<UpbringingView["goals"]> }) {
  const [open, setOpen] = useState(false);
  const text = (g: { text: string | null }) => g.text ?? tz("upbringing.goal_generic");
  const reward = (r: NonNullable<UpbringingView["goals"]>["items"][number]["rewards"][number]) =>
    r.kind === "growth" || r.kind === "skill" || r.kind === "item"
      ? tz(`ub.goals.reward.${r.kind}`, { label: r.label ?? "", value: r.value ?? 0 })
      : r.kind === "memory"
        ? tz("ub.goals.reward.memory")
        : "";
  return (
    <section className="ub-goals" data-testid="ub-goals">
      <h4>{tz("ub.goals.title", { y: goals.year })}</h4>
      {goals.items.length === 0 && <p className="ub-lead">{tz("ub.goals.none")}</p>}
      <ul className="ub-goal-list">
        {goals.items.map((g) => (
          <li key={g.key} className={`ub-goal ub-goal--${g.status}`}>
            <span className="ub-goal-text">{text(g)}</span>
            <span className="ub-goal-status">{tz(`ub.goals.status.${g.status}`)}</span>
            {g.objectives.map((o) => (
              <span key={o.key} className={o.done ? "ub-goal-progress is-good" : "ub-goal-progress"}>
                {tz("ub.goals.progress", { label: o.label, have: Math.min(o.have, o.need), need: o.need })}
              </span>
            ))}
            {g.rewards.some((r) => reward(r)) && (
              <span className="ub-goal-reward">
                {tz("ub.goals.reward", { text: g.rewards.map(reward).filter(Boolean).join("、") })}
              </span>
            )}
          </li>
        ))}
      </ul>
      {goals.history.length > 0 && (
        <details className="ub-goal-history" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
          <summary>{tz("ub.goals.history")}</summary>
          <ul>
            {goals.history.map((g) => (
              <li key={g.key} className={`ub-goal ub-goal--${g.status}`}>
                <span className="ub-goal-year">{g.year}</span>
                <span className="ub-goal-text">{text(g)}</span>
                <span className="ub-goal-status">{tz(`ub.goals.status.${g.status}`)}</span>
              </li>
            ))}
          </ul>
          {goals.history.some((g) => g.status === "missed") && <p className="ub-lead">{tz("ub.goals.missedNote")}</p>}
        </details>
      )}
    </section>
  );
}

function PathAndExams({ view, onPath, onExam, busy }: { view: UpbringingView; onPath: (key: string) => void; onExam: (key: string) => void; busy: boolean }) {
  const v2 = useIsV2();
  const p = view.path;
  // v2：还没有志向可选（也没定、也没到日子）时写一句，不留空白
  const noPath = v2 && !p.chosen && !p.choose_on && p.options.every((o) => o.hidden);
  return (
    <div className="ub-path">
      {view.goals && <Goals goals={view.goals} />}
      <section>
        <h4>{t("ub.pathTitle")}</h4>
        {p.chosen ? (
          <p className="ub-path-chosen">{p.options.find((o) => o.key === p.chosen)?.name ?? p.chosen}</p>
        ) : p.choose_on ? (
          <p className="ub-lead">{t("ub.pathOn", { y: p.choose_on[0], m: p.choose_on[1] })}</p>
        ) : null}
        {noPath && <EmptyState text={t("v2.upbringing.pathNone")} className="ub-empty-state" />}
        <ul className="ub-path-options">
          {p.options
            .filter((o) => !o.hidden)
            .map((o) => (
              <li key={o.key} className={o.key === p.chosen ? "is-chosen" : undefined}>
                <button type="button" className="ub-path-btn" disabled={busy || !!p.chosen || o.locked || !!p.choose_on} onClick={() => onPath(o.key)}>
                  <span className="ub-path-name">{o.name}</span>
                  <span className="ub-path-desc">{o.desc}</span>
                </button>
              </li>
            ))}
        </ul>
      </section>
      <section>
        <h4>{t("ub.exams")}</h4>
        {v2 && view.exams.length === 0 && <EmptyState text={t("v2.upbringing.examsNone")} className="ub-empty-state" />}
        <ul className="ub-exams">
          {view.exams.map((e) => (
            <li key={e.key} className={`ub-exam ub-exam--${e.status}`}>
              <span className="ub-exam-name">{e.name}</span>
              <span className="ub-exam-status">{tk(`ub.exam.${e.status}`)}</span>
              {e.pass_pct !== null && <span className="ub-exam-pct">{t("ub.passPct", { n: e.pass_pct })}</span>}
              {e.requirements.length > 0 && <span className="ub-exam-req">{e.requirements.join("；")}</span>}
              {e.status === "open" && (
                <button type="button" className="ts-btn ts-btn-small" disabled={busy} onClick={() => onExam(e.key)}>
                  {t("ub.takeExam")}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function UbSide({
  view,
  defs,
  attrName,
  tab,
  onTab,
  onPath,
  onExam,
  busy,
}: {
  view: UpbringingView;
  defs: CaptainDefsView | null | undefined;
  attrName: (k: string) => string;
  tab: SideTab;
  onTab: (t: SideTab) => void;
  onPath: (key: string) => void;
  onExam: (key: string) => void;
  busy: boolean;
}) {
  const unread = view.letters.filter((l) => !l.read).length;
  return (
    <aside className="ub-side" aria-label={t("ub.side")}>
      <div className="ub-tabs ub-side-tabs" role="tablist" aria-label={t("ub.side")}>
        {SIDE_TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "ub-tab is-on" : "ub-tab"} onClick={() => onTab(k)}>
            {tk(`ub.tab.${k}`)}
            {k === "letters" && unread > 0 && <span className="ub-badge">{unread}</span>}
          </button>
        ))}
      </div>
      <div className="ub-side-body" role="tabpanel">
        {tab === "attrs" && <Attrs view={view} defs={defs} attrName={attrName} />}
        {tab === "bonds" && <Bonds view={view} />}
        {tab === "calendar" && <Calendar view={view} />}
        {tab === "album" && <Album view={view} />}
        {tab === "letters" && <Letters view={view} />}
        {tab === "diary" && <Diary view={view} />}
        {tab === "path" && <PathAndExams view={view} onPath={onPath} onExam={onExam} busy={busy} />}
      </div>
    </aside>
  );
}
