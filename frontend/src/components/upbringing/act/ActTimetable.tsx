// 周初的课表（舞台下方展开的一块，上面仍看得到地图）：本周 5 格（学院 7 格，第 2、4 天另有晚课），
// 每格选“哪门课 + 第几档”，可以邀一位在那门课的地方的人同行（一周一格）。每格写学费、疲劳、成的机会与主要的两项成长。
// 改一格就把整张课表交给后端（PlanLessons），预计以后端算的为准；不合法的当场被拒、提示条写原因。
// 模板三份：存下这张、一键用回。开课（StartWeek）在底下一栏，学费不够时写差多少。
import type { LessonPlanInput, LessonSlotView, LineView } from "../../../ipc/actTypes";
import { OWNER, type ActCtx } from "./actCtx";
import { useState } from "react";
import { tz } from "../../../i18n/zhOnly";
import { Ladder } from "./ActK2";
import { tierFacts, tierNeeds, tierOpen } from "./k2Kit";
import { peopleAt, slotGains, stageLines, tenths } from "./actKit";
import { ta } from "./actText";

function Slot({ ctx, s, onPick, withTaken }: { ctx: ActCtx; s: LessonSlotView; onPick: (patch: Partial<LessonPlanInput>) => void; withTaken: boolean }) {
  const { act, names, busy } = ctx;
  // K3b：出海那几周课表由船上定（PlanLessons 会被拒），只能看
  const editable = act.phase === "plan" && !s.past && !busy && !act.voyage;
  const lines = stageLines(act);
  const line = act.lines.find((l) => l.key === s.line);
  const here = line ? peopleAt(act, line.place) : [];
  const done = s.result;
  // U06F5：出海那几周的课是船上派的活计，不是排的：不画下拉框与档位按钮，也不写“未开 / 下一档缺什么 / 同行”
  if (act.voyage)
    return (
      <li className={`ua-slot ua-slot--ship${s.past ? " is-past" : ""}${done ? ` is-${done.grade}` : ""}`} data-testid={`ua-slot-${s.index}`}>
        <header className="ua-slot-head">
          <b>{s.date[2]} 日</b>
          <span className="ua-slot-kind">{tz("ub.act.voyage.lessonsTag")}</span>
        </header>
        <p className="ua-slot-ship">
          <b>{names.line(s.line)}</b> {tz("ub.act.voyage.slotTier", { n: s.tier + 1 })}
        </p>
        <p className="ua-slot-act">{names.activity(s.activity)}</p>
        <ul className="ua-slot-nums">
          {slotGains(s, names.attr).map((g) => (
            <li key={g} className="ua-up">
              {g}
            </li>
          ))}
          <li>{ta("tt.fatigue", { n: tenths(s.fatigue_x10) })}</li>
          <li className={s.success_pct < 80 ? "ua-down" : undefined}>{ta("tt.success", { n: s.success_pct })}</li>
          {s.great_pct !== null && <li>{ta("tt.great", { n: s.great_pct })}</li>}
        </ul>
      </li>
    );
  return (
    <li
      className={`ua-slot${s.past ? " is-past" : ""}${s.kind === "evening" ? " is-evening" : ""}${done ? ` is-${done.grade}` : ""}`}
      data-testid={`ua-slot-${s.index}`}
    >
      <header className="ua-slot-head">
        <b>{s.date[2]} 日</b>
        {s.kind === "evening" && <span className="ua-slot-kind">{ta("tt.evening")}</span>}
        {s.past && <span className="ua-quiet">{ta("tt.past")}</span>}
      </header>
      <select
        className="ua-select"
        aria-label={`${s.date[2]} 日`}
        value={s.line ?? ""}
        disabled={!editable}
        onChange={(e) => onPick({ line: e.target.value, tier: 0, with: null })}
      >
        {s.line === null && <option value="">—</option>}
        {lines.map((l) => (
          <option key={l.key} value={l.key}>
            {names.line(l.key)}
          </option>
        ))}
      </select>
      {line && (
        <div className="ua-tiers" role="radiogroup" aria-label={names.line(line.key)}>
          {line.tiers.map((t, i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={s.tier === i}
              className={`ua-tier${s.tier === i ? " is-on" : ""}${tierOpen(t) ? "" : " is-locked"}${t.new ? " is-new" : ""}`}
              disabled={!editable || !tierOpen(t)}
              title={[
                `${names.activity(t.activity)}${tierOpen(t) ? "" : ` · ${ta("tt.tierLocked")}`}${t.gate && t.master !== true ? ` · ${ta("tt.tierGate")}` : ""}`,
                // K2：这一档对照着看——每格多少、学费、器具；没开的写缺什么
                ...tierFacts(line, t, names),
                ...(tierOpen(t) ? [] : tierNeeds(line, t, names, act)),
              ].join("\n")}
              onClick={() => onPick({ tier: i })}
            >
              {i + 1}
              {t.new && <span className="ua-tier-new">{ta("tt.tierNew")}</span>}
            </button>
          ))}
        </div>
      )}
      <p className="ua-slot-act">{names.activity(s.activity)}</p>
      <ul className="ua-slot-nums">
        {slotGains(s, names.attr).map((g) => (
          <li key={g} className="ua-up">
            {g}
          </li>
        ))}
        <li>{ta("tt.fee", { n: s.fee })}</li>
        <li>{ta("tt.fatigue", { n: tenths(s.fatigue_x10) })}</li>
        <li className={s.success_pct < 80 ? "ua-down" : undefined}>{ta("tt.success", { n: s.success_pct })}</li>
        {s.great_pct !== null && <li>{ta("tt.great", { n: s.great_pct })}</li>}
        {(s.tool_due ?? 0) > 0 && <li className="ua-down">{tz("ub.act.tier.toolDue", { n: s.tool_due ?? 0 })}</li>}
      </ul>
      {line && !s.past && <NextTier ctx={ctx} line={line} />}
      {(here.length > 0 || s.with) && (
        <label className="ua-with" title={ta("tt.withTip")}>
          <span>{ta("tt.with")}</span>
          <select
            className="ua-select ua-select--small"
            value={s.with ?? ""}
            disabled={!editable || (withTaken && !s.with)}
            onChange={(e) => onPick({ with: e.target.value || null })}
          >
            <option value="">{ta("tt.withNone")}</option>
            {here.map((k) => (
              <option key={k} value={k}>
                {names.person(k)}
              </option>
            ))}
          </select>
        </label>
      )}
    </li>
  );
}

/** 这门的下一档还缺什么（只写最近一档的一行；全表在“各档对照”里）。 */
function NextTier({ ctx, line }: { ctx: ActCtx; line: LineView }) {
  const i = line.tiers.findIndex((t) => !tierOpen(t));
  if (i < 0) return null;
  const needs = tierNeeds(line, line.tiers[i], ctx.names, ctx.act);
  if (needs.length === 0) return null;
  return (
    <p className="ua-slot-next" title={needs.join("\n")}>
      {tz(needs.length > 1 ? "ub.act.tier.nextMore" : "ub.act.tier.next", { n: i + 1, what: needs[0], k: needs.length })}
    </p>
  );
}

export function ActTimetable({ ctx, onClose }: { ctx: ActCtx; onClose: () => void }) {
  const { act, busy } = ctx;
  const [ladder, setLadder] = useState(false);
  const hasLadder = !act.voyage && act.lines.some((l) => l.tiers.some((t) => t.missing !== undefined));
  const slots = act.lessons.slots;
  const editable = act.phase === "plan" && !busy && !act.voyage;
  const fallback = stageLines(act)[0]?.key ?? "";
  const current = (): LessonPlanInput[] => slots.map((s) => ({ line: s.line ?? fallback, tier: s.tier, with: s.with }));
  const pick = (i: number, patch: Partial<LessonPlanInput>) => {
    const next = current().map((x, j) => (j === i ? { ...x, ...patch } : x));
    void ctx.send({ PlanLessons: { ...OWNER, slots: next } });
  };
  const withTaken = slots.some((s) => s.with);
  const short = act.lessons.fee_week - act.money.cash;
  // 今年各主属性还能长多少（同一属性的几门只写一次）
  const roomOf = new Map<string, number>();
  for (const l of stageLines(act)) if (l.tier >= 0 && l.attr && !roomOf.has(l.attr)) roomOf.set(l.attr, l.year_room);
  const yearRoom = [...roomOf].map(([attr, n]) => ta("tt.yearRoom", { attr: ctx.names.attr(attr), n }));
  return (
    <section className="ua-sheet" data-testid="ua-timetable" aria-label={ta("tt.title")}>
      <header className="ua-sheet-head">
        <h2>
          {ta("tt.title")} <span className="ua-quiet">{ta("tt.slots", { n: slots.length })}</span>
          {act.lessons.defaults && !act.voyage && <span className="ua-tag">{ta("tt.defaults")}</span>}
          {act.voyage && <span className="ua-tag ua-tag--ship">{tz("ub.act.voyage.lessonsTag")}</span>}
        </h2>
        <div className="ua-tpls" aria-label={ta("tt.templates")}>
          <span className="ua-quiet">{ta("tt.templates")}</span>
          {act.lessons.templates.map((t) => (
            <span key={t.slot} className="ua-tpl">
              <button
                type="button"
                className="ua-btn ua-btn--ghost"
                disabled={!editable || !t.lines}
                title={t.lines ? t.lines.map((l) => ctx.names.line(l)).join("、") : ta("tt.emptyTpl")}
                onClick={() => void ctx.send({ UseTemplate: { ...OWNER, slot: t.slot, kind: "lessons" } })}
              >
                {ta("tt.useN", { n: t.slot + 1 })}
                {!t.lines && <span className="ua-quiet">·{ta("tt.emptyTpl")}</span>}
              </button>
              <button
                type="button"
                className="ua-link"
                disabled={busy}
                onClick={() => void ctx.send({ SaveTemplate: { ...OWNER, slot: t.slot, kind: "lessons" } })}
              >
                {ta("tt.saveTo", { n: t.slot + 1 })}
              </button>
            </span>
          ))}
          {hasLadder && (
            <button type="button" className="ua-btn ua-btn--ghost" data-testid="ua-ladder-toggle" aria-pressed={ladder} onClick={() => setLadder((v) => !v)}>
              {ladder ? tz("ub.act.ladder.back") : tz("ub.act.ladder.toggle")}
            </button>
          )}
          <button type="button" className="ua-btn ua-btn--ghost" onClick={onClose}>
            {ta("tt.close")}
          </button>
        </div>
      </header>
      {act.voyage && <p className="ua-voyage-ttnote">{tz("ub.act.voyage.ttNote", { line: ctx.names.line(act.voyage.line), t: act.voyage.tier + 1 })}</p>}
      {ladder ? (
        <Ladder ctx={ctx} />
      ) : stageLines(act).length === 0 ? (
        <p className="ua-quiet">{ta("tt.noLines")}</p>
      ) : (
        <ol className="ua-slots" data-n={slots.length}>
          {slots.map((s, i) => (
            <Slot key={s.index} ctx={ctx} s={s} withTaken={withTaken} onPick={(p) => pick(i, p)} />
          ))}
        </ol>
      )}
      <footer className="ua-sheet-foot">
        <span>
          {ta("tt.total", { fee: act.lessons.fee_week, fat: tenths(act.lessons.fatigue_week_x10), proj: act.fatigue.projected })}
          {short > 0 && <b className="ua-short"> · {ta("tt.overBudget", { n: short })}</b>}
        </span>
        {yearRoom.length > 0 && <span className="ua-quiet">{yearRoom.join(" · ")}</span>}
      </footer>
    </section>
  );
}
