// 养成主画面（FRAMEWORK §7.14，docs/UI-CONTRACT.md I6）：主角在养成中时（Overview.mode === "upbringing"）整屏显示，代替港口街景与海图。
// 三栏：左边主角与四条数值、评价；中间本月日程与活动卡片（执行时换成这一旬的小场景与结算）；右边属性、羁绊、日历、相册、书信、日记、志向与考试。
// 顶上一条：阶段与日期、最近的三个倒计时（"两个月后是七夕"那一类）、零用钱、播放 / 暂停。
// 数据每当概览更新（version 变化）时重新取一次；日程草稿只在界面里，提交 PlanMonth 之后由后端的视图为准。
// 事件照旧由 StoryDialog 弹出（养成事件也是 Overview.story.pending）。
// 配乐：每次取到养成视图时把摘要交给配乐导演（audio/upbringing.ts），按阶段、节日、比赛与结业选曲。
// U05 按周排程（plan.mode === "week"）：提交 PlanWeek；常设周课表每周一自动铺开，暂停时中栏显示本周课表（能改本周还没结算的格），
// 播放时显示这一格的小场景与结算；改过的格在按“开始第 N 周”（周条、空格、回车）时先提交再开始。
// 顶上一条的“跳过剩余养成”（UI-CONTRACT I6 SkipUpbringing）：先确认，再提交；后端把剩下的日子按缺省结算完、直接结业，概览回到出海。
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { publishUpbringing } from "../../audio/upbringing";
import { useView } from "../../hooks/useView";
import { listJoin, t, tk } from "../../i18n";
import { api, onUpbringingProgress } from "../../ipc/api";
import type { UpbringingView } from "../../ipc/types";
import { useGame, useOverviewFields } from "../../store/game";
import { useConfirm } from "../feedback";
import { useGlobalHotkeys } from "../shell/hotkeys";
import { useIsV2 } from "../../ui/uiMode";
import { tz } from "../../i18n/zhOnly";
import { ShellIcon } from "../shell/ShellIcon";
import { loadFrom, saveTo } from "../shell/saveSlots";
import ContestDialog from "../contests/ContestDialog";
import { UbHero } from "./UbHero";
import { UbPlanner } from "./UbPlanner";
import { UbScene } from "./UbScene";
import { UbSide } from "./UbSide";
import { PauseMode, UbWeek } from "./UbWeek";
import { StoryTextPicker } from "../panels/StoryTextPicker";
import {
  applySlots,
  draftOf,
  isComplete,
  isWeekly,
  planDirty,
  setSceneCulture,
  toSlots,
  upcoming,
  type Draft,
  type SideTab,
} from "./ubKit";
import { LeaveConfirmHost } from "../shell/LeaveConfirm";
import { askLeave } from "../shell/leaveAsk";
import { StoryButton } from "../story/StoryPanel";
import { pendingKey, useStoryUi } from "../story/storyKit";
import { ActOldSave } from "./act/ActOldSave";
import { ActScreen } from "./act/ActScreen";
import { useUbActOn } from "../tutorial/tutorialState";

/** 执行中：这个月的三旬，进行中的一旬画大场景，结完的一旬写结算。 */
function Running({
  view,
  attrName,
}: {
  view: UpbringingView;
  attrName: (k: string) => string;
}) {
  const cur =
    view.plan.slots.find((s) => s.status === "current") ??
    view.plan.slots.find((s) => s.status !== "done") ??
    view.plan.slots[0];
  const acts = new Map(
    [...view.lessons, ...view.activities].map((a) => [a.key, a]),
  );
  const act = cur
    ? acts.get(cur.after?.activity ?? cur.lesson ?? "")
    : undefined;
  return (
    <section
      className="ub-running"
      aria-live="polite"
      aria-label={t("ub.running")}
    >
      <UbScene scene={act?.scene ?? "home"} size="large" label={act?.name} activity={act?.key}>
        <span className="ub-running-caption">
          {cur
            ? t("ub.runningCaption", { slot: cur.label, act: act?.name ?? "" })
            : ""}
        </span>
      </UbScene>
      <ol className="ub-running-slots">
        {view.plan.slots.map((s) => (
          <li key={s.index} className={`ub-rslot ub-rslot--${s.status}`}>
            <span className="ub-rslot-label">{s.label}</span>
            {s.result ? (
              <span className="ub-rslot-result">
                <b
                  className={s.result.success === false ? "is-fail" : undefined}
                >
                  {s.result.title}
                </b>
                {s.result.growth
                  .filter((g) => g.delta !== 0)
                  .map((g) => (
                    <span
                      key={g.attr}
                      className={g.delta > 0 ? "ub-up" : "ub-down"}
                    >
                      {attrName(g.attr)} {g.delta > 0 ? "+" : ""}
                      {g.delta}
                    </span>
                  ))}
                {s.result.affinity.map((a) => (
                  <span key={a.person} className="ub-up">
                    {t("ub.affinityDelta", {
                      name: a.name,
                      n: a.delta > 0 ? `+${a.delta}` : a.delta,
                    })}
                  </span>
                ))}
                {s.result.items.map((it) => (
                  <span key={it.item} className="ub-item-got">
                    {t("ub.itemGot", { name: it.name, n: it.qty })}
                  </span>
                ))}
                {s.result.line && (
                  <span className="ub-rslot-line">{s.result.line}</span>
                )}
              </span>
            ) : (
              <span className="ub-rslot-wait">
                {s.status === "current" ? t("ub.inProgress") : t("ub.waiting")}
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function UpbringingScreen() {
  const statics = useGame((s) => s.statics);
  // 按字段选取（P14a）：只取用到的顶层字段，没变就不重渲染
  const overview = useOverviewFields("story", "speed", "captain");
  const submit = useGame((s) => s.submit);
  const setSpeed = useGame((s) => s.setSpeed);
  const [draft, setDraft] = useState<Draft | null>(null);
  // 上一次起草时的"月份与阶段"：换了才重置草稿（同一个月里概览更新不会冲掉玩家正在排的日程）
  const [planKey, setPlanKey] = useState("");
  const [tab, setTab] = useState<SideTab>("attrs");
  const [busy, setBusy] = useState(false);
  const [contest, setContest] = useState<string | null>(null);
  const confirm = useConfirm();

  // 世界的状态变了时重新取养成视图（取不到时为 null）；换了月份（或日程被后端改了）时重置草稿（在渲染中同步重置，不闪“载入中”）
  const view = useView("upbringing", () => api.upbringing(), {
    quiet: true,
  }).data;
  // U06F6：养成期里场景图按主角家庭的文化换（ubKit.cultureScene）；渲染时就设好，同一轮里的剧情对话框取图时已生效
  setSceneCulture(view?.culture ?? view?.town?.culture ?? null);
  useEffect(() => () => setSceneCulture(null), []);
  // 按周时还带上第几周与下一格：换周、结算了一格都重新起草（暂停改课表时这两样不变，草稿不会被冲掉）
  const viewPlanKey = view
    ? `${view.plan.month.join("-")}:${view.phase}${isWeekly(view) ? `:w${view.plan.week ?? 0}:${view.plan.next_slot ?? 0}:${view.stage}` : ""}`
    : null;
  if (view && viewPlanKey !== null && viewPlanKey !== planKey) {
    setPlanKey(viewPlanKey);
    setDraft(draftOf(view.plan));
  }

  const attrName = useCallback(
    (k: string) =>
      statics?.captain?.attributes.find((a) => a.key === k)?.name ?? k,
    [statics],
  );
  const marks = useMemo(() => (view ? upcoming(view.calendar, 3) : []), [view]);

  // 配乐：把养成视图的摘要（阶段、节日、比赛、结业）与比赛的小游戏开没开交给配乐导演；离开养成主画面时收回
  // （静态数据一并交过去：认得出所在城市时，平时的轮换里也放出海以后这一带的港口曲与航海曲）
  useEffect(() => publishUpbringing(view, contest !== null, statics), [view, contest, statics]);
  useEffect(() => () => publishUpbringing(null), []);
  // U06F2：行动制的画面在时，告诉养成教程别启动（旧教程圈的块在行动制下都不在）
  const actOn = !!view?.act;
  const viewKnown = !!view;
  useEffect(() => {
    useUbActOn.setState({ on: actOn, known: viewKnown });
  }, [actOn, viewKnown]);
  useEffect(() => () => useUbActOn.setState({ on: false, known: false }), []);

  // 新界面的全局快捷键（shell/hotkeys.ts）：空格与顶上的播放键一样，只在这个月进行中时暂停 / 继续；回车按“开始这个月”
  const v2 = useIsV2();
  const pending = overview?.story?.pending;
  // 收起（“稍后再说”）的剧情还在等回应：周条的主按钮先把它交还给玩家
  const storyDismissed = useStoryUi((s) => s.dismissed);
  const storyWaiting = !!pending && storyDismissed === pendingKey(pending);
  const canPlay = !!view && (view.phase !== "plan" || !!pending);
  const onPlayback = () => {
    // 收起对话不等于已经回答；把等待中的剧情重新交给玩家，避免反复按播放仍走不动。
    if (pending && useStoryUi.getState().dismissed === pendingKey(pending)) {
      useStoryUi.getState().reopen();
      return;
    }
    const paused = !overview || overview.speed === 0;
    // 按周：暂停时改过本周的格，开始前先提交 PlanWeek（写回常设周课表）；没排齐就先不开始，日程里写着差什么
    if (paused && view && draft && planDirty(view, draft)) {
      if (!isComplete(view, draft)) return;
      void (async () => {
        const r = await submit({ PlanWeek: { owner: "player", slots: toSlots(view, draft) } });
        if (r) await setSpeed(useGame.getState().runSpeed || 1);
      })();
      return;
    }
    void setSpeed(paused ? useGame.getState().runSpeed || 1 : 0);
  };
  useGlobalHotkeys(v2, {
    // R10-U06 行动制有自己的快捷键（act/ActScreen.tsx），这里不挂
    pause: canPlay && !view?.act ? onPlayback : null,
  });

  if (!view || !draft) {
    return (
      <div className="ub-screen ub-loading" data-testid="upbringing">
        <p>{t("loading")}</p>
      </div>
    );
  }

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const onSubmit = () =>
    run(async () => {
      const slots = toSlots(view, draft);
      const r = await submit(
        isWeekly(view)
          ? { PlanWeek: { owner: "player", slots } }
          : { PlanMonth: { owner: "player", slots } },
      );
      // 提交以后让时间走起来（暂停中的话按上一次的倍速）
      if (r && overview && overview.speed === 0)
        await setSpeed(useGame.getState().runSpeed || 1);
    });
  const onPreset = (preset: string) =>
    run(async () => {
      try {
        const plan = await api.autoPlan(preset);
        setDraft(applySlots(draft, plan.slots));
      } catch (e) {
        useGame.getState().fail(e);
      }
    });
  const onPath = (path: string) =>
    run(() => submit({ ChoosePath: { owner: "player", path } }));
  const onExam = (exam: string) =>
    run(() => submit({ TakeExam: { owner: "player", exam } }));
  // 跳过剩余的养成：收不回来，先问一句（确认对话框里办，办的时候写“正在办……”）
  const onSkip = (extra?: ReactNode) =>
    confirm.run(
      {
        title: t("ub.skipAsk"),
        body: extra ? (
          <>
            <SkipBody />
            {extra}
          </>
        ) : (
          <SkipBody />
        ),
        confirmLabel: t("ub.skipGo"),
        done: t("ub.skipDone"),
      },
      () => submit({ SkipUpbringing: { owner: "player" } }),
    );
  const paused = !overview || overview.speed === 0;

  // R10-U06 行动制：视图带 act 时整屏换成行动制的画面（地图、地点、课表、周末、小结）；没有 act 时下面原样不动
  if (view.act)
    return (
      <>
        {/* HOTFIX1：“回到主菜单（不存档）”的确认框宿主，旧分支里有、这里原先漏了（askLeave 只开开关，没人显示框） */}
        <LeaveConfirmHost />
        <ActScreen view={view} act={view.act} menu={<UbMenu pause />} onSkip={(extra) => void onSkip(extra)} />
        {confirm.dialog}
      </>
    );

  return (
    <div
      className="ub-screen"
      data-testid="upbringing"
      data-stage={view.stage}
      data-phase={view.phase}
      data-season={view.protagonist.season}
    >
      <LeaveConfirmHost />
      <header className="ub-top">
        <div className="ub-top-stage">
          <span className="ub-stage">{view.stage_name}</span>
          <span className="ub-date">
            {t("ub.dateYmd", {
              y: view.today[0],
              m: view.today[1],
              d: view.today[2],
            })}
          </span>
          <span className="ub-season">
            {tk(`season.${view.protagonist.season}`)}
          </span>
        </div>
        <ul className="ub-countdowns" aria-label={t("ub.countdowns")}>
          {marks.map((m) => (
            <li
              key={`${m.kind}:${m.key}`}
              className={`ub-countdown ub-cal--${m.kind}`}
            >
              {m.heart && <span className="ub-cal-heart">♡</span>}
              {m.days_left === 0
                ? t("ub.todayIs", { name: m.name })
                : t("ub.countdown", { name: m.name, n: m.days_left })}
            </li>
          ))}
        </ul>
        <div className="ub-top-actions">
          {overview && <StoryButton o={overview} />}
          <button
            type="button"
            className="ts-btn ts-btn-small ub-play"
            aria-label={paused ? t("ub.play") : t("ub.pause")}
            title={
              v2
                ? view.phase === "plan"
                  ? tz("hk.ub.playPlan")
                  : `${paused ? t("ub.play") : t("ub.pause")}${tz("hk.spaceSuffix")}`
                : undefined
            }
            disabled={!canPlay}
            onClick={onPlayback}
          >
            <ShellIcon name={paused ? "play" : "pause"} scale={2} />
          </button>
          <button
            type="button"
            className="ts-btn ts-btn-small ub-skip"
            data-testid="ub-skip"
            disabled={busy || view.phase === "done"}
            onClick={() => void onSkip()}
          >
            {t("ub.skip")}
          </button>
          <UbMenu />
        </div>
      </header>
      {/* 按周播放的世界：这一周是几号到几号、这个月的几周过到哪儿，与“开始第 N 周”的主按钮（P10 接线） */}
      <UbWeek view={view} paused={paused} storyWaiting={storyWaiting} onAction={onPlayback} />
      {/* R10-U06：本家已换成行动制、这是旧档时提示一句（新玩法从新开的局开始） */}
      {view.act_old_save && <ActOldSave />}
      {/* U04：刚完成的年度目标、最近开放的练习 / 地点 / 志向 / 考试 / 评价段位 */}
      {((view.goals?.done_now ?? []).length > 0 || (view.unlocked_now ?? []).some((u) => u.label)) && (
        <ul className="ub-unlocked" aria-live="polite" data-testid="ub-unlocked">
          {(view.goals?.done_now ?? []).map((k) => {
            const g = view.goals?.items.find((x) => x.key === k) ?? view.goals?.history.find((x) => x.key === k);
            return (
              <li key={`goal:${k}`} className="ub-unlocked-item is-good">
                {tz("ub.goals.doneNow", { text: g?.text ?? tz("upbringing.goal_generic") })}
              </li>
            );
          })}
          {(view.unlocked_now ?? [])
            .filter((u) => u.label)
            .map((u) => (
              <li key={`${u.kind}:${u.key}:${u.rank ?? ""}`} className="ub-unlocked-item">
                {tz(`ub.unlock.now.${u.kind}`, { label: u.label ?? "", rank: u.rank ?? "" })}
              </li>
            ))}
        </ul>
      )}
      {/* 结业以后：结局、另得的称号、差一点走到的两个结局各差什么（U04） */}
      {view.phase === "done" && view.ending && (
        <section className="ub-summary" data-testid="ub-summary" aria-label={tz("ub.end.title")}>
          <h3>{view.ending.title ?? tz("ub.end.title")}</h3>
          {view.ending.text && <p className="ub-summary-text">{view.ending.text}</p>}
          {(view.supplementary ?? []).some((e) => e.title) && (
            <p className="ub-summary-extra">
              {tz("ub.end.supplementary", { list: listJoin((view.supplementary ?? []).flatMap((e) => (e.title ? [e.title] : []))) })}
            </p>
          )}
          {(view.near_miss ?? []).length > 0 && (
            <>
              <h4>{tz("ub.end.nearMiss")}</h4>
              <ul className="ub-summary-near">
                {(view.near_miss ?? []).map((m) => (
                  <li key={m.ending}>
                    {tz("ub.end.nearItem", {
                      title: m.title ?? tz("ub.end.other"),
                      gaps: listJoin(
                        m.missing.map((g) =>
                          !g.label
                            ? tz("ub.end.gapStory")
                            : g.need === 1 && g.have <= 1 && !g.max && /^(exam|contest|activity):/.test(g.key)
                              ? tz("ub.end.gapOnce", { label: g.label })
                              : g.max
                                ? tz("ub.end.gapMax", { label: g.label, have: g.have, need: g.need })
                                : tz("ub.end.gap", { label: g.label, have: g.have, need: g.need }),
                        ),
                      ),
                    })}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {confirm.dialog}
      {(view.contests ?? []).some(
        (c) => c.status !== "upcoming" || c.result,
      ) && (
        <ul className="ub-contests" aria-label={t("ct.list")} tabIndex={0}>
          {(view.contests ?? [])
            .filter((c) => c.status === "open" || c.result)
            .map((c) => (
              <li key={c.key} className={`ub-contest ub-contest--${c.status}`}>
                <span className="ub-contest-name">{c.name}</span>
                <span className="ub-contest-kind">
                  {tk(`ct.kind.${c.kind}`)}
                </span>
                {c.junior && (
                  <span className="ub-contest-kind">{tz("ct.junior")}</span>
                )}
                {c.prep > 0 && (
                  <span className="is-good">{t("ct.prep", { n: c.prep })}</span>
                )}
                {/* U04：报名制。报了名才会在比赛日结算；玩小游戏本身也算报名 */}
                {!c.result && c.registered && (
                  <span className="is-good">
                    {c.days_left
                      ? tz("ct.registered", { n: c.days_left })
                      : tz("ct.registeredToday")}
                  </span>
                )}
                {!c.result && c.can_register && (
                  <button
                    type="button"
                    className="ts-btn ts-btn-small"
                    onClick={() =>
                      void submit({
                        PlayContest: {
                          owner: "player",
                          contest: c.key,
                          moves: { register: true },
                        },
                      })
                    }
                  >
                    {tz("ct.register")}
                  </button>
                )}
                {c.result ? (
                  <span className="ub-contest-result">
                    {t("ct.result", {
                      rank: c.result.rank,
                      total: c.result.total,
                      text: c.result.text,
                    })}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="ts-btn ts-btn-small"
                    onClick={() => setContest(c.key)}
                  >
                    {t("ct.play")}
                  </button>
                )}
              </li>
            ))}
        </ul>
      )}
      {contest && (
        <ContestDialog contest={contest} onClose={() => setContest(null)} />
      )}
      <div className="ub-body">
        <UbHero view={view} />
        {view.phase === "running" && (!isWeekly(view) || !paused) ? (
          <Running view={view} attrName={attrName} />
        ) : (
          <UbPlanner
            view={view}
            draft={draft}
            onDraft={setDraft}
            attrName={attrName}
            onSubmit={() => void onSubmit()}
            onPreset={(p) => void onPreset(p)}
            busy={busy}
            onStory={pending ? () => useStoryUi.getState().reopen() : undefined}
          />
        )}
        <UbSide
          view={view}
          defs={statics?.captain}
          attrName={attrName}
          tab={tab}
          onTab={setTab}
          onPath={(p) => void onPath(p)}
          onExam={(e) => void onExam(e)}
          busy={busy}
        />
      </div>
    </div>
  );
}

/** 跳过养成的说明；办的时候后端每推进至多七天推一次进度（P05），这里接着写推进到了哪年哪月。 */
function SkipBody() {
  const [at, setAt] = useState<{
    y: number;
    m: number;
    pct: number | null;
  } | null>(null);
  useEffect(() => {
    let off: (() => void) | null = null;
    let alive = true;
    void onUpbringingProgress((p) => {
      if (!alive || p.done) return;
      setAt({
        y: p.date[0],
        m: p.date[1],
        pct: p.total
          ? Math.min(100, Math.round((p.day / p.total) * 100))
          : null,
      });
    }).then((un) => {
      if (alive) off = un;
      else un();
    });
    return () => {
      alive = false;
      off?.();
    };
  }, []);
  return (
    <>
      <span>{t("ub.skipBody")}</span>
      {at && (
        <span
          className="ub-skip-progress"
          role="status"
          data-testid="ub-skip-progress"
        >
          {at.pct === null
            ? t("ub.skipProgress", { y: at.y, m: at.m })
            : t("ub.skipProgressPct", { y: at.y, m: at.m, pct: at.pct })}
        </span>
      )}
    </>
  );
}

/**
 * 养成画面的菜单：存档、读档、回主菜单（与游戏里顶栏菜单的“存档”“系统”两节相同）。Esc 或点外面收起。
 * pause（FIX4F，行动制）：再加“养成期播放的停顿”——行动制没有周条，原来只有出海后的设置里改得了。
 */
function UbMenu({ pause = false }: { pause?: boolean }) {
  const [open, setOpen] = useState(false);
  const [slot, setSlot] = useState("save1");
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest(".ub-menu"))
        setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);
  return (
    <div className="ub-menu">
      <button
        type="button"
        className="ts-btn ts-btn-small ub-menu-btn"
        aria-expanded={open}
        data-testid="ub-menu"
        onClick={() => setOpen((v) => !v)}
      >
        <ShellIcon name="menu" scale={1} />
        {t("menu")}
      </button>
      {open && (
        <div className="ub-menu-pop" data-testid="ub-menu-pop">
          <div className="ub-menu-saves saves">
            <input
              aria-label={t("saveSlot")}
              value={slot}
              onChange={(e) => setSlot(e.target.value)}
              size={10}
            />
            <button type="button" onClick={() => void saveTo(slot)}>
              <ShellIcon name="save" scale={1} />
              {t("save")}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void loadFrom(slot);
              }}
            >
              <ShellIcon name="load" scale={1} />
              {t("load")}
            </button>
          </div>
          {pause && <PauseMode inMenu />}
          {/* L01F2：剧情文本（Claude 原文 / Gemini 重写）——养成期没有设置页签，在这里切；语言是英文时不出现 */}
          <StoryTextPicker variant="menu" />
          <button type="button" className="ub-menu-leave" onClick={askLeave}>
            {t("ub.toTitle")}
          </button>
        </div>
      )}
    </div>
  );
}
