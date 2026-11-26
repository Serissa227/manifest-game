// R10-U06 养成行动制的主画面（docs/R10-U06.md 9.1、9.20；视图契约 docs/tasks/R10-U06K1.md 契约 5）。
// 养成视图带 act 时由 UpbringingScreen 换成这一屏；没有 act（开关关着、别家、旧档）时照旧画原来的养成画面。
//
// 布局：顶上一条（周、两本账的计数、钱 / 疲劳 / 心情）→ 日历条（本周 + 后四周）→ 舞台。
// 舞台的上半是主角：城镇地图（或进了地点的场景、平日上课的场景），图按原比例铺开、不被面板盖住；
// 下半是这一阶段的一条（周初的停因与开课、周末的行动点 / 家业 / 结束这一周、小结），课表展开时也在这里、地图跟着缩小。
// 一周：周初（停因 → 开课）→ 平日五格逐格出结果 → 第六天停在地图上花行动点、做家业 → 结束这一周 → 小结 → 下一周。
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { tz, type ZhOnlyKey } from "../../../i18n/zhOnly";
import { useView } from "../../../hooks/useView";
import { api } from "../../../ipc/api";
import type { ActView, FreeSkipView } from "../../../ipc/actTypes";
import type { Command, UpbringingView } from "../../../ipc/types";
import { useGame, useOverviewFields } from "../../../store/game";
import { useIsV2 } from "../../../ui/uiMode";
import ContestDialog from "../../contests/ContestDialog";
import { useGlobalHotkeys } from "../../shell/hotkeys";
import { ShellIcon } from "../../shell/ShellIcon";
import { StoryButton } from "../../story/StoryPanel";
import { pendingKey, useStoryUi } from "../../story/storyKit";
import { UbSide } from "../UbSide";
import type { SideTab } from "../ubKit";
import { OWNER, type ActCtx } from "./actCtx";
import { needsDecision, calendarWeeks, lessonCount, makeNames, pointDots, resultChips, signed, skipText, startBlock, isInlandVoyage, stopLines, tenths, thinkHints, templateList, weekTitle, deltaChips } from "./actKit";
import { reasonOf, ta, type ActTextKey } from "./actText";
import { K2Chips, MomentBar, ScoreBook, SkipCapital, SummaryK2 } from "./ActK2";
import { CalTide, DutyRisk, K3Book, K3Row, SummaryK3 } from "./ActK3";
import { ActVoyage, CalVoyage } from "./ActK3b";
import { useK3Names } from "./useK3Names";
import { ActLessons } from "./ActLessons";
import { ActMap } from "./ActMap";
import { ActPlace } from "./ActPlace";
import { ActTimetable } from "./ActTimetable";
import { actTownKey } from "./townMaps";
import { loadUbPause, useUbPause } from "../ubPause";

/** 课业时间按“快”走（一天半秒）：一周五个平日约两秒半，结果在场景里逐格闪过（规格 9.1“约 2 秒一周”）。 */
const LESSON_SPEED = 8;

// ───────────── 顶栏 ─────────────

function Dots({ left, max, label }: { left: number; max: number; label: string }) {
  return (
    <span className="ua-dots" aria-label={label}>
      {pointDots(left, max).map((d, i) => (
        <span key={i} className={`ua-dot is-${d}`} aria-hidden />
      ))}
    </span>
  );
}

function Top({ ctx, menu, onBook, onSkip, paused, onPlay }: { ctx: ActCtx; menu: ReactNode; onBook: () => void; onSkip: () => void; paused: boolean; onPlay: (() => void) | null }) {
  const { view, act } = ctx;
  const o = useOverviewFields("story", "captain");
  const lc = lessonCount(act);
  const pts = act.points;
  const bonus = pts.bonus.map((b) => ta(b.kind === "constitution" ? "top.bonus.constitution" : "top.bonus.rank", { n: b.value })).join("，");
  const tired = act.fatigue.value >= act.fatigue.fail_at ? (act.fatigue.value >= act.fatigue.ill_at ? "bad" : "warn") : "ok";
  const day = act.week.day >= 8 ? ta("top.idle") : ta("top.day", { d: act.week.day });
  return (
    <header className="ua-top">
      <div className="ua-when">
        <span className="ua-stage-name">{view.stage_name}</span>
        <b className="ua-week">{weekTitle(act.week.from)}</b>
        {act.week.day < 8 && <span className="ua-day">{day}</span>}
        <span className="ua-phase" data-phase={act.phase}>
          {/* “结束这一周”之后周末余下的两天，后端的阶段仍是 lessons（时钟在走）：顶栏写“周末”，不写“上课”；
              HOTFIX1：月末闲日（第 8 天起）写“月末闲日”（日子那一格就不再重复） */}
          {act.phase === "lessons" && act.week.day >= 8
            ? ta("top.idle")
            : act.phase === "lessons" && act.week.day >= 6
              ? ta("phase.free")
              : ta(`phase.${act.phase}` as ActTextKey)}
        </span>
      </div>
      <div className="ua-books">
        <span className="ua-book" data-testid="ua-lessons-count" title={ta("top.lessonsTip", { done: lc.done, n: lc.total })}>
          <span className="ua-book-label">{ta("top.lessons")}</span>
          <span className="ua-bars" aria-hidden>
            {Array.from({ length: lc.total }, (_, i) => (
              <span key={i} className={i < lc.done ? "is-done" : undefined} />
            ))}
          </span>
          <b>
            {lc.done}/{lc.total}
          </b>
        </span>
        <span className="ua-book ua-book--points" data-testid="ua-points" title={[ta("top.pointsTip", { left: pts.left, max: pts.max }), bonus].filter(Boolean).join("\n")}>
          <span className="ua-book-label">{ta("top.points")}</span>
          <Dots left={pts.left} max={pts.max} label={ta("top.pointsTip", { left: pts.left, max: pts.max })} />
          <b>
            {pts.left}/{pts.max}
          </b>
        </span>
      </div>
      <K2Chips ctx={ctx} />
      <div className="ua-res">
        <span className="ua-res-item" title={ta("top.cashTip", { in: act.money.week_in, out: act.money.week_out })}>
          <span>{ta("top.cash")}</span>
          <b>{act.money.cash}</b>
        </span>
        <span
          className="ua-res-item"
          data-tone={tired}
          title={[
            ta("top.fatigueTip", { fail: act.fatigue.fail_at, ill: act.fatigue.ill_at, proj: act.fatigue.projected }),
            act.fatigue.ill_chance_pct !== null ? ta("top.fatigueIll", { n: act.fatigue.ill_chance_pct }) : "",
          ]
            .filter(Boolean)
            .join("\n")}
        >
          <span>{ta("top.fatigue")}</span>
          <b>{act.fatigue.value}</b>
          {act.fatigue.projected !== act.fatigue.value && <small>→{act.fatigue.projected}</small>}
        </span>
        <span className="ua-res-item">
          <span>{ta("top.mood")}</span>
          <b>{act.mood.value}</b>
        </span>
      </div>
      <div className="ua-top-actions">
        {o && <StoryButton o={o} />}
        {onPlay && (
          <button type="button" className="ua-btn ua-btn--night" onClick={onPlay} aria-label={paused ? ta("top.play") : ta("top.pause")}>
            <ShellIcon name={paused ? "play" : "pause"} scale={1} />
          </button>
        )}
        <button type="button" className="ua-btn ua-btn--night" data-testid="ua-book" title={ta("top.bookTip")} onClick={onBook}>
          {ta("top.book")}
        </button>
        <button type="button" className="ua-btn ua-btn--night ua-btn--quiet" data-testid="ub-skip" onClick={onSkip}>
          {ta("top.skip")}
        </button>
        {menu}
      </div>
    </header>
  );
}

// ───────────── 日历条 ─────────────

function Calendar({ ctx, onContest }: { ctx: ActCtx; onContest: (key: string) => void }) {
  const { act, view, names } = ctx;
  // U06F4：有潮汐表时，“潮起”那一条由每周的潮签代替
  const weeks = calendarWeeks(act.tide ? { ...act, calendar: act.calendar.filter((m) => m.kind !== "tide") } : act);
  const open = (view.contests ?? []).filter((c) => c.status === "open" && !c.result);
  return (
    <nav className="ua-cal" aria-label={ta("cal.label")} data-testid="ua-calendar">
      <ol className="ua-cal-weeks">
        {weeks.map((w) => (
          <li key={w.offset} className={`ua-cal-week${w.offset === 0 ? " is-now" : ""}`}>
            <span className="ua-cal-label">{w.label}</span>
            {/* U06F4：这一周的潮（有潮汐表时每周一枚；日历里“潮从哪天起”的那条并进这一枚，不另列） */}
            <CalTide ctx={ctx} offset={w.offset} />
            {/* U06F4 第二趟：报了名 / 在海上的那几周一枚“船” */}
            <CalVoyage ctx={ctx} offset={w.offset} />
            {w.marks.length === 0 ? (
              !act.tide &&
              <span className="ua-cal-empty">{ta("cal.empty")}</span>
            ) : (
              w.marks.map((m) => (
                <span key={`${m.kind}:${m.key}:${m.date.join("-")}`} className="ua-mark" data-kind={m.kind} title={`${m.date[1]} 月 ${m.date[2]} 日 · ${names.mark(m)}`}>
                  <i aria-hidden>{ta(`cal.kind.${m.kind}` as ActTextKey)}</i>
                  {ta("cal.day", { d: m.date[2] })}
                  <span className="ua-mark-name">{names.mark(m)}</span>
                </span>
              ))
            )}
          </li>
        ))}
      </ol>
      {open.length > 0 && (
        <ul className="ua-contests">
          {open.map((c) => (
            <li key={c.key} className="ua-contest">
              <span className="ua-contest-name">{c.name}</span>
              {c.registered ? (
                <span className="ua-quiet">{ta("ct.registered")}</span>
              ) : (
                c.can_register && (
                  <button
                    type="button"
                    className="ua-link"
                    disabled={ctx.busy}
                    onClick={() => void ctx.send({ PlayContest: { ...OWNER, contest: c.key, moves: { register: true } } })}
                  >
                    {ta("ct.register")}
                  </button>
                )
              )}
              <button type="button" className="ua-link" onClick={() => onContest(c.key)}>
                {ta("ct.play")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

// ───────────── 周初 ─────────────

function PlanBar({ ctx, ttOpen, onTimetable, onStart, gate }: { ctx: ActCtx; ttOpen: boolean; onTimetable: () => void; onStart: () => void; gate: boolean }) {
  const { act, names } = ctx;
  const all = stopLines(act, names, act.money.cash);
  // FIX6F：要拿主意的写在“停在这里”下面；只提醒的（后端 stop_info 的 blocking = false）单写一组“这周提醒”，主按钮照样是开课
  const stops = all.filter((s) => s.blocking);
  const reminds = all.filter((s) => !s.blocking);
  // HOTFIX1：有剧情等着回应时开课会被后端拒（ub.act.story）：按钮灰着写原因，旁边放“去回应”
  const block = gate ? ta("story.goFirst") : startBlock(act);
  const lc = lessonCount(act);
  const lookable = new Set(["tier_open", "fee", "fatigue", "restage", "blocked"]);
  return (
    <div className="ua-bar ua-bar--plan" data-testid="ua-plan">
      <div className="ua-bar-main">
        <K3Row ctx={ctx} />
        {stops.length > 0 ? (
          <div className="ua-stops" role="status">
            <span className="ua-stops-lead">{ta("stop.lead")}</span>
            <ul>
              {stops.map((s) => (
                <li key={s.key} className="ua-stop" data-stop={s.key}>
                  <b>{s.label}</b>
                  <span>{s.hint}</span>
                  {lookable.has(s.key) && !ttOpen && (
                    <button type="button" className="ua-link" onClick={onTimetable}>
                      {ta("stop.look")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : reminds.length === 0 ? (
          <div className="ua-quietline">
            <b>{ta("plan.quiet")}</b>
            <span>
              {ta("plan.quietHint", { n: lc.total, fee: act.lessons.fee_week, fat: tenths(act.lessons.fatigue_week_x10), proj: act.fatigue.projected })}
            </span>
          </div>
        ) : null}
        {reminds.length > 0 && (
          <div className="ua-stops ua-stops--remind" role="status" data-testid="ua-plan-remind">
            <span className="ua-stops-lead">{tz("ub.act.plan.remindLead")}</span>
            <ul>
              {reminds.map((s) => (
                <li key={s.key} className="ua-stop" data-stop={s.key}>
                  <b>{s.label}</b>
                  <span>{s.hint}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* 海上那几周没有“进城”可言，不写这句 */}
        {!ttOpen && !act.voyage && <p className="ua-bar-note">{ta("plan.peek")}</p>}
      </div>
      <div className="ua-bar-go">
        <button type="button" className="ua-btn ua-btn--ghost" data-testid="ua-edit" aria-expanded={ttOpen} onClick={onTimetable}>
          {ttOpen ? ta("tt.close") : act.voyage ? tz("ub.act.voyage.look") : ta("plan.edit")}
        </button>
        {gate && <StoryGo />}
        <span className="ua-go-wrap">
          <button
            type="button"
            className="ua-btn ua-btn--primary"
            data-testid="ua-start"
            data-hotkey={gate ? undefined : "primary"}
            title={ta("plan.goTip")}
            disabled={ctx.busy || block !== null}
            onClick={onStart}
          >
            {ta("plan.go")} ▶
          </button>
          {block && <span className="ua-go-why">{block}</span>}
        </span>
      </div>
    </div>
  );
}

// ───────────── 周末：家业、模板、结束这一周 ─────────────

function Duty({ ctx }: { ctx: ActCtx }) {
  const fd = ctx.act.family_duty;
  const [pick, setPick] = useState<string | null>(null);
  if (!fd) return null;
  // K3b：出海期间家业停（FamilyDuty 会被拒），只写一句
  if (ctx.act.voyage)
    return (
      <section className="ua-duty" data-testid="ua-duty" aria-label={ta("duty.title")}>
        <header className="ua-duty-head">
          <b>{ta("duty.title")}</b>
          <span className="ua-quiet">{isInlandVoyage(ctx.act, ctx.act.voyage.key) ? tz("ub.act.voyage.dutyOffInland") : tz("ub.act.voyage.dutyOff")}</span>
        </header>
      </section>
    );
  const free = ctx.act.phase === "free";
  // FIX7：后端给每项家业 enabled / reason_text，整栏也有一份（病中、本周做过……）；按它灰掉并写原因（替掉 U06F5 界面自己判断“病着”的那一段）。
  // 旧后端不给 enabled 时当作能做。本周做过家业时照旧写“做完了”与收获
  const blocked = fd.enabled === false && !fd.done_this_week;
  const whyAll = blocked ? (reasonOf(fd.reason_text, fd.reason) ?? tz("ub.act.duty.off")) : null;
  return (
    <section className="ua-duty" data-testid="ua-duty" aria-label={ta("duty.title")}>
      <header className="ua-duty-head">
        <b>{ta("duty.title")}</b>
        <span className={blocked ? "ua-down" : "ua-quiet"} data-testid={blocked ? "ua-duty-off" : undefined}>
          {fd.done_this_week ? ta("duty.done") : (whyAll ?? ta("duty.hint"))}
        </span>
        {/* 本周家业的收获（U06K1b 的 last_result；后端没给时只写“做完了”），画法同地点对话条里的结果小签 */}
        {fd.done_this_week && fd.last_result?.success === false && (
          <span className="ua-down" data-testid="ua-duty-failed">
            {tz("ub.act.duty.failed")}
          </span>
        )}
        {fd.done_this_week && fd.last_result && (
          <span className="ua-chips" data-testid="ua-duty-result">
            {resultChips(ctx.names, fd.last_result).map((c) => (
              <span key={c.key} className={c.up ? "ua-up" : "ua-down"}>
                {c.text}
              </span>
            ))}
          </span>
        )}
      </header>
      <ul className="ua-duty-opts">
        {fd.options.map((d) => {
          const pct = d.milestone > 0 ? Math.min(100, Math.round((d.progress / d.milestone) * 100)) : 0;
          const desc = ctx.names.dutyDesc(d.key);
          const off = d.enabled === false;
          // 单项的原因：与整栏相同就不重复写（病中三项都是同一句）
          const why = off ? reasonOf(d.reason_text, d.reason) : null;
          const ownWhy = why && why !== whyAll && !fd.done_this_week ? why : null;
          return (
            <li key={d.key} className={`ua-duty-opt${pick === d.key ? " is-on" : ""}`}>
              <button
                type="button"
                className="ua-duty-btn"
                data-testid={`ua-duty-${d.key}`}
                aria-pressed={pick === d.key}
                disabled={fd.done_this_week || !free || ctx.busy || off}
                title={[desc, why].filter(Boolean).join("\n") || undefined}
                onClick={() => setPick(pick === d.key ? null : d.key)}
              >
                <span className="ua-duty-name">{ctx.names.duty(d.key)}</span>
                <span className="ua-duty-bar" aria-hidden>
                  <span style={{ width: `${pct}%` }} />
                </span>
                {/* U06F7：到了里程就写满（“30/30 ✓”），多做的不显示 */}
                <span className={`ua-duty-n${d.milestone > 0 && d.progress >= d.milestone ? " is-full" : ""}`}>
                  {d.milestone > 0 && d.progress >= d.milestone ? tz("ub.act.duty.full", { n: d.milestone }) : ta("duty.progress", { have: d.progress, need: d.milestone })}
                </span>
                <DutyRisk act={ctx.act} duty={d.key} />
                {ownWhy && <span className="ua-duty-why">{ownWhy}</span>}
              </button>
              {pick === d.key && (
                <div className="ua-duty-pop">
                  <b>{ctx.names.duty(d.key)}</b>
                  {desc && <p>{desc}</p>}
                  <button
                    type="button"
                    className="ua-btn ua-btn--ghost"
                    disabled={ctx.busy}
                    onClick={() =>
                      void ctx.send({ FamilyDuty: { ...OWNER, duty: d.key } }).then((ok) => {
                        if (ok) setPick(null);
                      })
                    }
                  >
                    {ta("duty.go")}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * FIX7：照周末模板做了几件、跳过了哪几件（做不了的那一步跳过、接着做后面的）。周末底栏与小结共用：
 * “照上周末做了 2 件”，有跳过的逐条“跳过：码头·打工（码头搬运）——这里不招这份活计”。一件没做也没跳过时不画。
 */
function TemplateDone({ ctx, applied, skipped, summary = false }: { ctx: ActCtx; applied: number; skipped: FreeSkipView[]; summary?: boolean }) {
  if (applied === 0 && skipped.length === 0) return null;
  return (
    <div className={`ua-tpl-done${summary ? " ua-sum-k2" : ""}`} data-testid={summary ? "ua-sum-tpl" : "ua-free-tpl"}>
      <span className="ua-quiet">{tz("ub.act.free.tplLead")}</span>
      <span className={applied > 0 ? "ua-up" : undefined}>{tz("ub.act.free.applied", { n: applied })}</span>
      {skipped.length > 0 && (
        <ul className="ua-tpl-skips">
          {skipped.map((s) => (
            <li key={`${s.step}:${s.place}:${s.kind}`} className="ua-down">
              {skipText(ctx.act, ctx.names, s)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FreeDock({ ctx, onOpen, onEnd, gate }: { ctx: ActCtx; onOpen: (place: string) => void; onEnd: () => void; gate: boolean }) {
  const { act, names, busy } = ctx;
  const hints = thinkHints(act, names);
  const spent = act.free.done.some((d) => d.cost > 0);
  const tpl = act.free.template.length > 0;
  // FIX6F：后端给了 free_stop（自由日没能自动走下去的原因）就写在主按钮下面；旧后端只给 halt 时照旧写在左边。
  // 只在停顿方式是“每月停 / 有事才停”时写（“每周停”下周末本来每一步都是玩家自己点，写原因只会嫌吵）；读不到设置时不写
  const pause = useUbPause((s) => s.pause);
  useEffect(() => {
    void loadUbPause();
  }, []);
  const stop = pause === "month" || pause === "event" ? (act.free_stop ?? null) : null;
  // 后端会自己往下走的情形：停顿方式不是“每周停”、自由日没有停因、没有剧情在等、不在海上（海上不套模板）
  const autoRunning = (pause === "month" || pause === "event") && !act.free_stop && !gate && !act.voyage && (act.free.auto_ok || (act.free.applied ?? 0) > 0);
  const halt = stop ? null : act.free.halt;
  const stopWhy = stop ? (reasonOf(stop.reason_text, stop.reason) ?? tz("ub.act.stop.other.hint")) : null;
  const stopPlace = stop && stop.step !== null && stop.place && act.places.some((p) => p.key === stop.place) ? stop.place : null;
  return (
    <div className="ua-bar ua-bar--free" data-testid="ua-free">
      <div className="ua-bar-main">
        <div className="ua-free-head">
          <span className="ua-free-points">
            <Dots left={act.points.left} max={act.points.max} label={ta("top.pointsTip", { left: act.points.left, max: act.points.max })} />
            <b>{act.points.left > 0 ? ta("pl.left", { n: act.points.left }) : ta("map.noPoints")}</b>
          </span>
          <span className="ua-bar-note">{ta("map.hintFree")}</span>
        </div>
        <K3Row ctx={ctx} />
        {hints.length > 0 && (
          <div className="ua-think" aria-label={ta("map.think")}>
            <span className="ua-think-lead">{ta("map.think")}</span>
            {hints.map((h) =>
              h.place ? (
                <button key={h.key} type="button" className={`ua-hint${h.urgent ? " is-urgent" : ""}`} onClick={() => h.place && onOpen(h.place)}>
                  {h.text} ›
                </button>
              ) : (
                <span key={h.key} className="ua-hint is-plain">
                  {h.text}
                </span>
              ),
            )}
          </div>
        )}
        {halt && <p className="ua-halt">{ta("map.halt", { n: halt.step + 1, why: reasonOf(halt.reason_text, halt.reason) ?? "" })}</p>}
        <TemplateDone ctx={ctx} applied={act.free.applied ?? 0} skipped={act.free.skipped ?? []} />
        {/* U06F7：出海时“照上周末做”灰着，原因写出来（船上不照岸上的安排） */}
        {act.voyage && <p className="ua-bar-note" data-testid="ua-tpl-voyage">{tz("ub.act.free.tplVoyage")}</p>}
        {/* U06F7：“每月停 / 有事才停”下，后端在照模板代办周末、做完自己往下走，中间要等几秒——写一句进行中，别让画面像卡住 */}
        {autoRunning && (
          <p className="ua-autorun" role="status" data-testid="ua-autorun">
            <span className="ua-autorun-dot" aria-hidden />
            {(act.free.applied ?? 0) > 0 || act.free.done.some((d) => d.cost > 0) ? tz("ub.act.free.autoAfter") : tz("ub.act.free.autoRun")}
          </p>
        )}
      </div>
      <Duty ctx={ctx} />
      <div className="ua-bar-go ua-bar-go--free">
        <button
          type="button"
          className="ua-btn ua-btn--ghost"
          data-testid="ua-use-free"
          disabled={busy || !tpl || act.points.left === 0 || !!act.voyage}
          title={act.voyage ? tz("ub.act.free.tplVoyage") : tpl ? ta("map.useTplHint", { list: templateList(act, names) }) : tz("ub.act.free.noTpl")}
          onClick={() => void ctx.send({ UseTemplate: { ...OWNER, slot: 0, kind: "free" } })}
        >
          {ta("map.useTpl")}
        </button>
        <button
          type="button"
          className="ua-btn ua-btn--ghost"
          data-testid="ua-save-free"
          disabled={busy || !spent}
          title={ta("map.saveTplHint")}
          onClick={() => void ctx.send({ SaveTemplate: { ...OWNER, slot: 0, kind: "free" } })}
        >
          {ta("map.saveTpl")}
        </button>
        {gate && <StoryGo />}
        <span className="ua-go-wrap">
          <button
            type="button"
            className="ua-btn ua-btn--primary"
            data-testid="ua-end"
            data-hotkey={gate ? undefined : "primary"}
            disabled={busy || gate}
            onClick={onEnd}
          >
            {ta("map.end")}
          </button>
          {stop && !gate && (
            <span className="ua-go-stop" role="status" data-testid="ua-free-stop" data-kind={stop.kind}>
              {stop.step !== null &&
                (stopPlace ? (
                  <button type="button" className="ua-link" onClick={() => onOpen(stopPlace)}>
                    {tz("ub.act.free.stopStep", { n: stop.step + 1 })} ›
                  </button>
                ) : (
                  <b>{tz("ub.act.free.stopStep", { n: stop.step + 1 })}</b>
                ))}
              <span>{tz(stop.step !== null ? "ub.act.free.stopAt" : "ub.act.free.stop", { why: stopWhy ?? "" })}</span>
            </span>
          )}
          {gate ? (
            <span className="ua-go-why">{ta("story.goFirst")}</span>
          ) : (
            act.points.left > 0 && <span className="ua-go-why">{ta("map.endHint", { n: act.points.left })}</span>
          )}
        </span>
      </div>
    </div>
  );
}

// ───────────── 小结 ─────────────

function Summary({ ctx, onNext, onLook, gate }: { ctx: ActCtx; onNext: () => void; onLook: () => void; gate: boolean }) {
  const { act, names } = ctx;
  const s = act.summary;
  if (!s) return null;
  const grow = [...deltaChips(s.growth, names.attr), ...deltaChips(s.skill, names.skill)];
  const people = deltaChips(s.affinity, names.person);
  const next = calendarWeeks(act, 1)[0]?.marks ?? [];
  const tone = (v: number, goodUp: boolean) => (v === 0 ? undefined : v > 0 === goodUp ? "ua-up" : "ua-down");
  return (
    <section className="ua-bar ua-bar--summary" data-testid="ua-summary" aria-label={ta("sum.title")}>
      <div className="ua-sum-head">
        <h2>{ta("sum.title")}</h2>
        <span className="ua-quiet">{ta("sum.range", { a: `${s.from[1]} 月 ${s.from[2]} 日`, b: `${s.to[1]} 月 ${s.to[2]} 日` })}</span>
        <span className="ua-sum-stats">
          {ta("sum.lessons", { ok: s.lessons_ok, fail: s.lessons_fail })} · {ta("sum.points", { n: s.points_used })} · {ta("sum.markers", { n: s.markers_seen })}
        </span>
      </div>
      <SummaryK2 ctx={ctx} />
      <SummaryK3 ctx={ctx} />
      {s.free_template && <TemplateDone ctx={ctx} applied={s.free_template.applied} skipped={s.free_template.skipped} summary />}
      <div className="ua-sum-grid">
        <div className="ua-sum-col ua-sum-col--wide">
          <h3 className="ua-h">{ta("sum.growth")}</h3>
          {grow.length === 0 ? (
            <p className="ua-quiet">{ta("sum.noGrowth")}</p>
          ) : (
            <span className="ua-chips">
              {grow.map((c) => (
                <span key={c.key} className={c.up ? "ua-up" : "ua-down"}>
                  {c.text}
                </span>
              ))}
            </span>
          )}
        </div>
        <div className="ua-sum-col ua-sum-nums">
          <span>
            {ta("sum.money")} <b className={tone(s.cash, true)}>{signed(s.cash)}</b>
          </span>
          <span>
            {ta("sum.fatigue")} <b className={tone(s.fatigue, false)}>{signed(s.fatigue)}</b> <small>→{act.fatigue.value}</small>
          </span>
          <span>
            {ta("sum.mood")} <b className={tone(s.mood, true)}>{signed(s.mood)}</b> <small>→{act.mood.value}</small>
          </span>
        </div>
        <div className="ua-sum-col">
          <h3 className="ua-h">{ta("sum.people")}</h3>
          {people.length === 0 ? (
            <p className="ua-quiet">{ta("sum.noPeople")}</p>
          ) : (
            <span className="ua-chips">
              {people.map((c) => (
                <span key={c.key} className={c.up ? "ua-up" : "ua-down"}>
                  {c.text}
                </span>
              ))}
            </span>
          )}
        </div>
        <div className="ua-sum-col">
          <h3 className="ua-h">{ta("sum.next")}</h3>
          {next.length === 0 ? (
            <p className="ua-quiet">{ta("sum.nextEmpty")}</p>
          ) : (
            <ul className="ua-sum-next">
              {next.map((m) => (
                <li key={`${m.kind}:${m.key}:${m.date.join("-")}`} className="ua-mark" data-kind={m.kind}>
                  <i aria-hidden>{ta(`cal.kind.${m.kind}` as ActTextKey)}</i>
                  {ta("cal.day", { d: m.date[2] })} <span className="ua-mark-name">{names.mark(m)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="ua-bar-go">
        {gate && <StoryGo />}
        <button type="button" className="ua-btn ua-btn--ghost" data-testid="ua-look" title={ta("sum.lookTip")} disabled={ctx.busy || gate} onClick={onLook}>
          {ta("sum.look")}
        </button>
        <span className="ua-go-wrap">
          <button
            type="button"
            className="ua-btn ua-btn--primary"
            title={ta("sum.goTip")}
            data-testid="ua-next"
            data-hotkey={gate ? undefined : "primary"}
            disabled={ctx.busy || gate}
            onClick={onNext}
          >
            {ta("sum.go")} ▶
          </button>
          {gate && <span className="ua-go-why">{ta("story.goFirst")}</span>}
        </span>
      </div>
    </section>
  );
}

// ───────────── 刚完成的年度目标、刚开放的东西（旧画面的 ub-unlocked；第三趟挪到底栏上方一条，可关掉） ─────────────

function Unlocked({ view }: { view: UpbringingView }) {
  const done = view.goals?.done_now ?? [];
  const opened = (view.unlocked_now ?? []).filter((u) => u.label);
  const items = [
    ...done.map((k) => {
      const g = view.goals?.items.find((x) => x.key === k) ?? view.goals?.history.find((x) => x.key === k);
      return { key: `goal:${k}`, good: true, text: tz("ub.goals.doneNow", { text: g?.text ?? tz("upbringing.goal_generic") }) };
    }),
    ...opened.map((u) => ({ key: `${u.kind}:${u.key}:${u.rank ?? ""}`, good: false, text: tz(`ub.unlock.now.${u.kind}` as ZhOnlyKey, { label: u.label ?? "", rank: u.rank ?? "" }) })),
  ];
  const sig = items.map((i) => i.key).join("|");
  const [closed, setClosed] = useState("");
  if (items.length === 0 || closed === sig) return null;
  return (
    <div className="ua-bar ua-bar--thin ua-unlocked" role="status" aria-live="polite" data-testid="ub-unlocked">
      <ul>
        {items.map((i) => (
          <li key={i.key} className={i.good ? "is-good" : undefined}>
            {i.text}
          </li>
        ))}
      </ul>
      <button type="button" className="ua-btn ua-btn--ghost" onClick={() => setClosed(sig)}>
        {ta("unlocked.close")}
      </button>
    </div>
  );
}

// ───────────── 人物升级的当场提示（U06F5） ─────────────

/**
 * 深谈、送礼、寒暄把人推过一级线的那一下，当场在底栏上方提一句：“千鸟升到 2 级——肯陪你出门……”。
 * 只比较同一周里前后两次视图的 people[].level（换周、小结不提：小结里另有“升到几级”）；“知道了”收起。
 */
function LevelUp({ ctx }: { ctx: ActCtx }) {
  const { act, names } = ctx;
  const k3 = useK3Names(ctx);
  const sig = `${act.week.index}`;
  const levels = useMemo(() => new Map((act.people ?? []).map((p) => [p.key, p.level])), [act.people]);
  const [prev, setPrev] = useState<{ sig: string; levels: Map<string, number> }>({ sig, levels });
  const [shown, setShown] = useState<{ key: string; text: string }[]>([]);
  if (prev.levels !== levels) {
    const ups: { key: string; text: string }[] = [];
    if (prev.sig === sig && act.phase !== "summary")
      for (const p of act.people ?? []) {
        const before = prev.levels.get(p.key);
        if (before === undefined || p.level <= before) continue;
        const got = p.perks.filter((k) => k.level > before && k.level <= p.level);
        const what = got.map((k) => k3.perk(k)).join("；");
        ups.push({ key: `${p.key}:${p.level}`, text: what ? tz("ub.act.levelUp.perk", { who: names.person(p.key), n: p.level, what }) : tz("ub.act.levelUp", { who: names.person(p.key), n: p.level }) });
      }
    setPrev({ sig, levels });
    setShown(prev.sig === sig ? [...shown, ...ups] : ups);
  }
  if (shown.length === 0) return null;
  return (
    <div className="ua-bar ua-bar--thin ua-unlocked ua-levelup" role="status" aria-live="polite" data-testid="ua-levelup">
      <ul>
        {shown.map((u) => (
          <li key={u.key} className="is-good">
            {u.text}
          </li>
        ))}
      </ul>
      <button type="button" className="ua-btn ua-btn--ghost" onClick={() => setShown([])}>
        {ta("unlocked.close")}
      </button>
    </div>
  );
}

// ───────────── 有剧情等着回应（HOTFIX1） ─────────────

/** “去回应”：把收起来的剧情对话框重新打开。行动制里剧情没回应时间不走、开课等命令会被拒，所以这是唯一的出口，做成主按钮。 */
function StoryGo() {
  return (
    <button type="button" className="ua-btn ua-btn--primary" data-testid="ua-story-go" data-hotkey="primary" title={ta("story.gate")} onClick={() => useStoryUi.getState().reopen()}>
      {ta("story.go")}
    </button>
  );
}

// ───────────── 主画面 ─────────────

/** onSkip 的参数：跳过养成的确认框里另加的一段（K2：照现在结业的清单）。 */
export function ActScreen({ view, act, menu, onSkip }: { view: UpbringingView; act: ActView; menu: ReactNode; onSkip: (extra?: ReactNode) => void }) {
  const statics = useGame((s) => s.statics);
  const submit = useGame((s) => s.submit);
  const setSpeed = useGame((s) => s.setSpeed);
  const o = useOverviewFields("story", "speed", "awaiting");
  const inventory = useView("inventory", () => api.inventory(), { quiet: true }).data;
  const [busy, setBusy] = useState(false);
  const [place, setPlace] = useState<string | null>(null);
  const [ttOpen, setTtOpen] = useState(false);
  const [book, setBook] = useState(false);
  const [tab, setTab] = useState<SideTab>("attrs");
  const [contest, setContest] = useState<string | null>(null);
  // 换了一周：回到地图、收起课表（在渲染中同步重置，不闪一下旧的）
  const [weekKey, setWeekKey] = useState(`${act.week.index}:${act.phase}`);
  const nowKey = `${act.week.index}:${act.phase}`;
  if (nowKey !== weekKey) {
    setWeekKey(nowKey);
    if (act.phase !== "free" && act.phase !== "plan") setPlace(null);
    if (act.phase !== "plan") setTtOpen(false);
    // 有排不上的格时直接把课表摊开：不改就开不了课
    if (act.phase === "plan" && act.stops.includes("blocked")) setTtOpen(true);
  }

  const items = useMemo(() => new Map((inventory?.items ?? []).map((i) => [i.key, i.name])), [inventory]);
  const names = useMemo(
    () => makeNames(view, act, statics?.captain?.attributes, items, statics?.upbringing_act_texts),
    [view, act, statics, items],
  );
  const town = useMemo(() => actTownKey(view.town?.key, act.places.map((p) => p.key)), [view.town, act.places]);
  // BuyItem 的 loc：后端的购物校验认的是“当前城市”（cast 的所在地 = 视图的 town.key），不用地图映射后的键
  const loc = useMemo(() => statics?.locations.find((l) => l.key === view.town?.key)?.id ?? null, [statics, view.town]);
  const send = async (cmd: Command): Promise<boolean> => {
    setBusy(true);
    try {
      const ok = (await submit(cmd)) !== null;
      // U06F9：剧情框开着时被拒（后端“眼前有事等你回应，先看完”）：对话框晃一下、框里写这一句，玩家知道为什么点了没用
      if (!ok) {
        const ov = useGame.getState().overview;
        const pend = ov?.story?.pending;
        if (pend && useStoryUi.getState().dismissed !== pendingKey(pend)) useStoryUi.getState().poke(useGame.getState().error ?? ta("story.goFirst"), pendingKey(pend));
      }
      return ok;
    } finally {
      setBusy(false);
    }
  };
  const ctx: ActCtx = { view, act, names, town, loc, busy, send };
  const k3 = useK3Names(ctx);

  const paused = !o || o.speed === 0;
  const pending = o?.story?.pending;
  const dismissed = useStoryUi((s) => s.dismissed);
  const storyWaiting = !!pending && dismissed === pendingKey(pending);
  // 剧情以外在等的事（海战等）：它们有自己的对话框，这里只写一句指路的话
  const otherWait = !storyWaiting && !!o?.awaiting && o.awaiting !== "story" && o.awaiting !== "upbringing";
  const run = (speed: number) => void setSpeed(speed);
  // 开课 / 结束这一周之后让时钟走起来——但不和应用层抢：周初、周末时后端自动停表并记下停前的倍速，命令一过它会按那个倍速自己续上
  // （handlers.rs 的 auto_resume / act_autoplay）。所以等一下再看：还停着（玩家原来就是手动暂停的）才由界面按“快”开走。
  // 第三趟：只在没有别的事在等（剧情、海战、遭遇、来客）时才由界面开走
  const kick = () =>
    window.setTimeout(() => {
      const ov = useGame.getState().overview;
      const waiting = !!ov?.story?.pending || (!!ov?.awaiting && ov.awaiting !== "upbringing");
      if ((ov?.speed ?? 0) === 0 && !waiting) run(LESSON_SPEED);
    }, 350);
  // K2 关键时刻：答完等一会儿，时钟还停着才开走（同“开课”的保险；后端以后会自己续上）
  const onAnswer = (pick: "steady" | "risky" | "clever") =>
    void send({ AnswerMoment: { ...OWNER, pick } }).then((ok) => {
      if (ok) kick();
    });
  const onStart = () =>
    void send({ StartWeek: { ...OWNER } }).then((ok) => {
      if (ok) kick();
    });
  const onEnd = () =>
    void send({ EndFree: { ...OWNER } }).then((ok) => {
      if (ok) kick();
    });
  // U06F3 第四趟：“下一周”一步到位——CloseWeek 之后看新的周初：没有要玩家拿主意的停因（needsDecision），界面接着开课；
  // 只是提醒的停因（这周有事、主命到期）记下来，开课后在底栏提一句。后端在“按月 / 按事件”停顿时自己也会代发 StartWeek
  // （handlers.rs act_autoplay），所以先重读一次视图：已经不在周初了就不再发。
  const [remind, setRemind] = useState<{ week: number; text: string } | null>(null);
  const onNext = () =>
    void send({ CloseWeek: { ...OWNER } }).then(async (ok) => {
      if (!ok) return;
      const next = (await api.upbringing().catch(() => null))?.act;
      const ov = useGame.getState().overview;
      if (!next || next.phase !== "plan" || needsDecision(next) || startBlock(next) !== null || ov?.story?.pending) return;
      const notes = stopLines(next, names, next.money.cash)
        .filter((l) => !l.blocking)
        .map((l) => `${l.label} ${l.hint}`)
        .join("；");
      if (notes) setRemind({ week: next.week.index, text: notes });
      if (await send({ StartWeek: { ...OWNER } })) kick();
    });
  const onLook = () =>
    void send({ CloseWeek: { ...OWNER } }).then((ok) => {
      if (ok) setTtOpen(true);
    });
  // 上课的几天时间在走：顶上给一个停 / 走（第四趟：周末余下的日子自动走完，不给停）
  const ticking = act.phase === "lessons" && act.week.day <= 5;
  // HOTFIX1：剧情收着时时钟走不了，不给“走 / 停”（底栏有“去回应”）
  const onPlay = ticking && !storyWaiting ? () => run(paused ? LESSON_SPEED : 0) : null;

  const v2 = useIsV2();
  useGlobalHotkeys(v2, {
    pause: ticking && !storyWaiting ? () => onPlay?.() : null,
    closeWindow: book ? () => setBook(false) : place ? () => setPlace(null) : ttOpen ? () => setTtOpen(false) : null,
  });
  // 第四趟：“结束这一周”以后余下的日子（第 6、7 天，月末闲日更多）自动走完：时钟停着、又没有别的事在等，就开到最快（陆上 8 倍是上限）
  const restDays = act.phase === "lessons" && act.week.day > 5;
  const pendingStory = !!pending;
  useEffect(() => {
    if (!restDays || !paused || pendingStory || otherWait) return;
    const id = window.setTimeout(() => {
      if ((useGame.getState().overview?.speed ?? 0) === 0) void setSpeed(LESSON_SPEED);
    }, 250);
    return () => window.clearTimeout(id);
  }, [restDays, paused, pendingStory, otherWait, setSpeed]);
  // 地点的数据里没有这个地点了（换阶段）：回地图
  useEffect(() => {
    if (place && !act.places.some((p) => p.key === place)) setPlace(null);
  }, [place, act.places]);

  const weekday = act.week.day <= 5;
  // 关键时刻（K2）停在课上：舞台仍是那门课的场景，底栏换成三张卡
  const showLessons = !place && (act.phase === "lessons" || act.phase === "moment") && weekday;
  let stage: ReactNode;
  if (place) stage = <ActPlace ctx={ctx} place={place} onBack={() => setPlace(null)} />;
  else if (showLessons) stage = <ActLessons ctx={ctx} onSkip={() => undefined} />;
  // K3b：海上那几周船不在城里——不画城镇图，列这一程能去的地点
  else if (act.voyage) stage = <ActVoyage ctx={ctx} k3={k3} onOpen={setPlace} />;
  else stage = <ActMap ctx={ctx} onOpen={setPlace} />;

  let bottom: ReactNode = null;
  if (place) bottom = null;
  else if (act.phase === "plan")
    bottom = (
      <>
        {ttOpen && <ActTimetable ctx={ctx} onClose={() => setTtOpen(false)} />}
        <PlanBar ctx={ctx} ttOpen={ttOpen} onTimetable={() => setTtOpen((v) => !v)} onStart={onStart} gate={storyWaiting} />
      </>
    );
  else if (act.phase === "free") bottom = <FreeDock ctx={ctx} onOpen={setPlace} onEnd={onEnd} gate={storyWaiting} />;
  else if (act.phase === "summary") bottom = <Summary ctx={ctx} onNext={onNext} onLook={onLook} gate={storyWaiting} />;
  else if ((act.phase === "lessons" || act.phase === "moment") && storyWaiting)
    // HOTFIX1：上课的几天（含 K2 的关键时刻）剧情被收起——时间停着、“继续”也没用，底栏只给“去回应”
    bottom = (
      <div className="ua-bar ua-bar--thin ua-bar--story" role="status" data-testid="ua-story-gate">
        <span className="ua-bar-note">{ta("story.gate")}</span>
        <StoryGo />
      </div>
    );
  else if (act.phase === "moment" && act.moment) bottom = <MomentBar ctx={ctx} onAnswer={onAnswer} />;
  else if (act.phase === "lessons" && !weekday) {
    // 第四趟：余下的日子在地图上自动走完，底栏一句带进度；万一时钟没开起来（后端拒了倍速），留一个“继续”
    const total = Math.max(act.week.day, act.week.to[2] - act.week.from[2] + 1);
    bottom = (
      <div className="ua-bar ua-bar--thin" role="status" data-testid="ua-rest">
        <span className="ua-bar-note">{otherWait ? ta("await.other") : ta("wk.rest", { d: act.week.day, n: total })}</span>
        <span className="ua-rest-bar" aria-hidden>
          <span style={{ width: `${Math.round((act.week.day / total) * 100)}%` }} />
        </span>
        {paused && !otherWait && (
          <button type="button" className="ua-btn ua-btn--ghost" onClick={() => run(LESSON_SPEED)}>
            {ta("top.play")} ▶
          </button>
        )}
      </div>
    );
  } else if (act.phase === "lessons" && !paused && remind && remind.week === act.week.index)
    // 第四趟：自动开课时带过来的提醒（这周有事、主命到期），上课那几天在底栏提一句
    bottom = (
      <div className="ua-bar ua-bar--thin" role="status" data-testid="ua-remind">
        <span className="ua-bar-note">
          <b>{ta("wk.remind")}</b> {remind.text}
        </span>
      </div>
    );
  else if (act.phase === "lessons" && (paused || !weekday))
    bottom = (
      <div className="ua-bar ua-bar--thin">
        {/* 时钟停着又不是剧情：多半是海战、遭遇、来客这类在等（overview.awaiting），写明；否则就是玩家自己停的，给“继续” */}
        <span className="ua-bar-note">{otherWait ? ta("await.other") : weekday ? ta("ls.paused") : ta("ls.weekend")}</span>
        {paused && !otherWait && (
          <button type="button" className="ua-btn ua-btn--primary" data-hotkey="primary" onClick={() => run(LESSON_SPEED)}>
            {ta("top.play")} ▶
          </button>
        )}
      </div>
    );
  else if (!place)
    // 阶段是 moment / story / voyage（K1 界面没有专门的一栏）或平日时钟在走：在等别的事，至少写一句、剧情收着时给出口
    bottom =
      act.phase === "lessons" ? null : (
        <div className="ua-bar ua-bar--thin" role="status" data-testid="ua-wait">
          <span className="ua-bar-note">{storyWaiting ? ta("story.gate") : otherWait ? ta("await.other") : ta("await.phase")}</span>
          {storyWaiting && <StoryGo />}
        </div>
      );

  return (
    <div className="ub-screen ua-screen" data-testid="upbringing" data-act={act.phase} data-stage={view.stage} data-season={view.protagonist.season}>
      <Top ctx={ctx} menu={menu} onBook={() => setBook((v) => !v)} onSkip={() => onSkip(<SkipCapital act={act} names={names} />)} paused={paused} onPlay={onPlay} />
      <Calendar ctx={ctx} onContest={setContest} />
      <div className="ua-stage" data-view={place ? "place" : showLessons ? "lessons" : "map"} data-tt={ttOpen || undefined}>
        <div className="ua-main">{stage}</div>
        {storyWaiting && place && (
          <div className="ua-bar ua-bar--thin ua-bar--story" role="status" data-testid="ua-story-gate">
            <span className="ua-bar-note">{ta("story.gate")}</span>
            <StoryGo />
          </div>
        )}
        <Unlocked view={view} />
        <LevelUp ctx={ctx} />
        {bottom && <div className="ua-bottom">{bottom}</div>}
      </div>
      {book && (
        <div className="ua-drawer" data-testid="ua-drawer">
          <button type="button" className="ua-drawer-close ua-btn ua-btn--ghost" onClick={() => setBook(false)}>
            {ta("tt.close")}
          </button>
          <ScoreBook ctx={ctx} />
          <K3Book ctx={ctx} />
          <UbSide
            view={view}
            defs={statics?.captain}
            attrName={names.attr}
            tab={tab}
            onTab={setTab}
            onPath={(p) => void send({ ChoosePath: { ...OWNER, path: p } })}
            onExam={(e) => void send({ TakeExam: { ...OWNER, exam: e } })}
            busy={busy}
          />
        </div>
      )}
      {contest && <ContestDialog contest={contest} onClose={() => setContest(null)} />}
    </div>
  );
}
