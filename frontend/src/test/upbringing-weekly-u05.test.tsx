// U05 养成排程改按周：家乡每周 3 格、学院每周 3 节课 + 2 格课余；常设周课表每周自动沿用，暂停时能改本周还没结算的格。
// 这里测 ubKit 的按周逻辑（格子、提交的 PlanWeek、本周预计按精确值加总、四周的周条、照课表起草、改没改过），
// 以及主画面：暂停时显示本周课表与每格的预计收益，没改过时“开始第 N 周”只开钟，改过时先提交 PlanWeek 再开钟；
// 课表铺不上停在安排阶段时，出问题的那一格就地写原因；周条上能选停顿方式。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { useStoryUi } from "../components/story/storyKit";
import UpbringingScreen from "../components/upbringing/UpbringingScreen";
import { cellsOf, draftOf, isComplete, monthLastDay, monthWeeks, planDirty, project, toSlots } from "../components/upbringing/ubKit";
import type { ActivityView, CaptainDefsView, SlotView, StaticView, UpbringingView } from "../ipc/types";
import { useGame } from "../store/game";
import { applyUi, useUiVersion } from "../ui/uiMode";
import { installIpc, overview, settingsView, statics } from "./fixtures";

function act(key: string, name: string, kind: ActivityView["kind"], weight: number, o: Partial<ActivityView> = {}): ActivityView {
  // 标准格的数（按旬时的一格）：成长 8–12、疲劳 8、心情 2、费用 4；卡片上给单格取整值，eighths 给精确值
  const std = { gains: [{ attr: "seamanship", range: [8, 12] as [number, number] }], fatigue: 8, mood: 2, cost: 4, income: [0, 0] as [number, number] };
  const r = (v: number) => Math.round((v * weight) / 8);
  return {
    key,
    name,
    desc: "",
    kind,
    scene: "home",
    cost: Math.ceil((std.cost * weight) / 8),
    income: [0, 0],
    fatigue: r(std.fatigue),
    mood: r(std.mood),
    gains: std.gains.map((g) => ({ attr: g.attr, range: [r(g.range[0]), r(g.range[1])] as [number, number] })),
    skills: [],
    mentor: null,
    companions: [],
    tier: null,
    risk: 0,
    needs: [],
    enabled: true,
    tags: [],
    new: false,
    weight,
    eighths: {
      cost: std.cost * weight,
      income: [0, 0],
      fatigue: std.fatigue * weight,
      mood: std.mood * weight,
      gains: std.gains.map((g) => ({ attr: g.attr, range: [g.range[0] * weight, g.range[1] * weight] as [number, number] })),
    },
    ...o,
  };
}

const COLUMNS: SlotView["column"][] = ["lesson", "after", "lesson", "after", "lesson"];
const DAYS = [8, 9, 10, 11, 12];

/** 学院期 1553 年 5 月第 2 周（8–14 日），5 格：课、课余、课、课余、课。 */
function view(o: { phase?: "plan" | "running"; done?: number; plan?: boolean; problem?: { index: number | null; reason: string } | null } = {}): UpbringingView {
  const phase = o.phase ?? "running";
  const done = o.done ?? 0;
  const planned = o.plan ?? phase === "running";
  const slots: SlotView[] = COLUMNS.map((column, i) => {
    const lesson = column === "lesson" ? "navigation_class" : null;
    const after = column === "after" ? { activity: "rest" } : null;
    return {
      index: i,
      label: `${DAYS[i]} 日`,
      from: [1553, 5, DAYS[i]],
      to: [1553, 5, DAYS[i]],
      column,
      day: i + 1,
      weight: column === "lesson" ? 2 : 3,
      locked: false,
      lesson: planned ? lesson : null,
      after: planned ? after : null,
      timetable: { lesson, after },
      status: i < done ? "done" : !planned ? "empty" : i === done && phase === "running" ? "current" : "planned",
    };
  });
  return {
    stage: "academy",
    stage_name: "学院 · 里斯本",
    home: "土佐中村",
    academy: { key: "lisbon", name: "里斯本航海学校", city: "里斯本" },
    today: [1553, 5, DAYS[done] ?? 13],
    week: { number: 2, from: [1553, 5, 8], to: [1553, 5, 14], count: 4, month_days: 31 },
    phase,
    protagonist: { key: "mio", name: "一条澪", age: 13, birthday: [6, 21], portrait: null, outfit: null, season: 0 },
    meters: {
      stamina: { value: 70, max: 100, label: "体力" },
      fatigue: { value: 20, max: 100, label: "疲劳" },
      mood: { value: 60, max: 100, label: "心情" },
      fame: { value: 10, max: 100, label: "名声" },
    },
    cash: 120,
    growth: [{ attr: "seamanship", value: 400, projected: 4 }],
    ratings: [],
    skills: [],
    plan: {
      month: [1553, 5],
      editable: true,
      slots,
      mode: "week",
      week: 2,
      weeks: 4,
      next_slot: done,
      timetable_problem: o.problem ?? null,
    },
    lessons: [act("navigation_class", "航海课", "lesson", 2), act("self_study", "自习", "lesson", 2, { cost: 0 })],
    activities: [act("rest", "休息", "rest", 3), act("dock_work", "码头打杂", "job", 3)],
    places: [],
    excursions: [],
    companions: [],
    calendar: [],
    exams: [],
    path: { choose_on: null, chosen: null, options: [] },
    memories: [],
    letters: [],
    diary: [],
    presets: [{ key: "previous", name: "照上周" }],
    last: [],
  };
}

describe("按周排程的纯逻辑（ubKit）", () => {
  it("一周 5 格，每格一格：课业格排课，课余格排别的；提交的 PlanWeek 每格只填一项", () => {
    const v = view();
    expect(cellsOf(v).map((c) => c.part)).toEqual(["lesson", "after", "lesson", "after", "lesson"]);
    expect(toSlots(v, draftOf(v.plan))).toEqual([
      { index: 0, lesson: "navigation_class", after: null },
      { index: 1, lesson: null, after: { activity: "rest" } },
      { index: 2, lesson: "navigation_class", after: null },
      { index: 3, lesson: null, after: { activity: "rest" } },
      { index: 4, lesson: "navigation_class", after: null },
    ]);
  });

  it("课表铺不上停下时，草稿先照常设周课表填好；只看还没结算的格算排没排满", () => {
    const v = view({ phase: "plan", plan: false });
    const d = draftOf(v.plan);
    expect(d.lesson[0]).toBe("navigation_class");
    expect(d.after[1]).toEqual({ activity: "rest" });
    expect(isComplete(v, d)).toBe(true);
    // 已经结算的两格不算
    const half = view({ done: 2 });
    const d2 = draftOf(half.plan);
    d2.lesson[0] = null;
    expect(isComplete(half, d2)).toBe(true);
  });

  it("本周预计按精确值加总再取整（单格取整值加起来会有误差）", () => {
    const v = view();
    const p = project(v, draftOf(v.plan));
    // 3 节课 × 2/8 + 2 格休息 × 3/8 = 12/8 个标准格；成长中点 10 × 12/8 = 15；疲劳 8 × 12/8 = 12；费用 4 × 12/8 = 6
    expect(p.growth.get("seamanship")).toBe(15);
    expect(p.fatigue).toBe(12);
    expect(p.mood).toBe(3);
    expect(p.cash).toBe(-6);
    // 已经结算的格不算进“本周余下”
    const half = view({ done: 3 });
    expect(project(half, draftOf(half.plan)).fatigue).toBe(Math.round((8 * 2 + 8 * 3) / 8));
  });

  it("周条：按周排程的世界每月固定 4 周，第 4 周到月末；月末日子由后端给", () => {
    expect(monthWeeks(31, 9, 4).map((w) => [w.from, w.to, w.state])).toEqual([
      [1, 7, "done"],
      [8, 14, "current"],
      [15, 21, "upcoming"],
      [22, 31, "upcoming"],
    ]);
    expect(monthWeeks(28, 28, 4).at(-1)).toEqual({ number: 4, from: 22, to: 28, state: "current" });
    expect(monthLastDay(view())).toBe(31);
  });

  it("改没改过：只比本周还没结算的格", () => {
    const v = view({ done: 1 });
    const d = draftOf(v.plan);
    expect(planDirty(v, d)).toBe(false);
    d.lesson[0] = "self_study";
    expect(planDirty(v, d)).toBe(false);
    d.lesson[2] = "self_study";
    expect(planDirty(v, d)).toBe(true);
  });
});

describe.each(["v1", "v2"] as const)("养成主画面（按周，%s）", (ui) => {
  const captain = {
    points: {},
    signs: [],
    questions: [],
    attributes: [{ key: "seamanship", name: "航海", desc: "", group: "craft" }],
    groups: [{ key: "craft", name: "本领", range: [1, 10], start: 1, free: 8, creation_cap: 7 }],
  } as unknown as CaptainDefsView;
  const s: StaticView = { ...statics, captain };
  const paused = { ...overview, speed: 0, mode: "upbringing" as const };

  beforeEach(() => {
    applyUi(ui);
    useUiVersion.setState({ ui });
    useStoryUi.setState({ dismissed: "", panel: false });
    useGame.setState({ statics: s, overview: paused, version: 1, error: null, message: null, runSpeed: 4 });
  });

  it("停在周一：显示本周 5 格（课 / 课余交错）与每格的预计收益，周条四段；没改过时“开始第 2 周”只开钟", async () => {
    const user = userEvent.setup();
    const calls = installIpc({ upbringing: () => view(), set_speed: () => ({ ...paused, speed: 4 }) });
    render(<UpbringingScreen />);
    const planner = await screen.findByRole("region", { name: "本月日程" });
    expect(within(planner).getByRole("heading", { level: 2 })).toHaveTextContent("1553 年 5 月 · 第 2 周");
    expect(screen.getByTestId("cell-0:lesson")).toHaveTextContent("课");
    expect(screen.getByTestId("cell-1:after")).toHaveTextContent("课余");
    expect(screen.getByTestId("cell-0:lesson")).toHaveTextContent("航海课");
    // 每格的预计收益：单格取整值（航海课 2/8 格：成长 2–3 取中点 3，疲劳 +2）
    expect(screen.getByTestId("gain-0")).toHaveTextContent("航海 +3");
    expect(screen.getByTestId("gain-0")).toHaveTextContent("+2");
    const bar = screen.getByTestId("ub-week");
    expect(within(bar).getAllByRole("listitem").map((e) => e.textContent)).toEqual(["1–7", "8–14", "15–21", "22–31"]);
    expect(within(bar).getByTestId("ub-week-no")).toHaveTextContent("第 2 周/4");
    expect(screen.getByTestId("ub-wk-note")).toHaveTextContent("课表会自动沿用到以后各周");
    // 运行中暂停：日程里不另给开始键，主按钮在周条上
    expect(within(planner).queryByRole("button", { name: "开始第 2 周" })).toBeNull();
    await user.click(within(bar).getByRole("button", { name: "开始第 2 周" }));
    await waitFor(() => expect(calls.mock.calls.filter(([n]) => n === "set_speed")).toHaveLength(1));
    expect(calls.mock.calls.filter(([n]) => n === "submit")).toHaveLength(0);
  });

  it("暂停时改了一格：开始第 2 周时先提交 PlanWeek（写回课表），再开钟", async () => {
    const user = userEvent.setup();
    const calls = installIpc({
      upbringing: () => view(),
      submit: () => ({ outcome: "Done", overview: paused }),
      set_speed: () => ({ ...paused, speed: 4 }),
    });
    render(<UpbringingScreen />);
    await screen.findByRole("region", { name: "本月日程" });
    await user.click(screen.getByTestId("cell-3:after"));
    await user.click(within(screen.getByTestId("act-dock_work")).getByRole("button"));
    expect(screen.getByTestId("cell-3:after")).toHaveTextContent("码头打杂");
    expect(screen.getByTestId("ub-wk-note")).toHaveTextContent("开始这一周时一并生效");
    await user.click(within(screen.getByTestId("ub-week")).getByRole("button", { name: "开始第 2 周" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: {
          PlanWeek: {
            owner: "player",
            slots: [
              { index: 0, lesson: "navigation_class", after: null },
              { index: 1, lesson: null, after: { activity: "rest" } },
              { index: 2, lesson: "navigation_class", after: null },
              { index: 3, lesson: null, after: { activity: "dock_work" } },
              { index: 4, lesson: "navigation_class", after: null },
            ],
          },
        },
      }),
    );
    await waitFor(() => expect(calls.mock.calls.filter(([n]) => n === "set_speed")).toHaveLength(1));
  });

  it("课表铺不上：停在安排阶段，出问题的那一格标出来并写原因；改好后“开始第 2 周”提交 PlanWeek", async () => {
    const user = userEvent.setup();
    const calls = installIpc({
      upbringing: () => view({ phase: "plan", plan: false, problem: { index: 3, reason: "零用钱不够" } }),
      submit: () => ({ outcome: "Done", overview: paused }),
    });
    render(<UpbringingScreen />);
    await screen.findByRole("region", { name: "本月日程" });
    expect(screen.getByText(/11 日的课余排不上：零用钱不够/)).toBeInTheDocument();
    expect(screen.getByTestId("cell-3:after").closest(".ub-cell")).toHaveClass("is-problem");
    expect(within(screen.getByTestId("ub-week")).getByTestId("ub-week-note")).toHaveTextContent("课表有一格排不上");
    await user.click(screen.getByTestId("cell-3:after"));
    await user.click(within(screen.getByTestId("act-rest")).getByRole("button"));
    await user.click(screen.getByRole("button", { name: "开始第 2 周" }));
    await waitFor(() => expect(calls.mock.calls.some(([n, a]) => n === "submit" && "PlanWeek" in (a.command as object))).toBe(true));
  });

  it("已经结算的格只读，结果照写；下一格是“进行中”", async () => {
    installIpc({ upbringing: () => view({ done: 2 }) });
    render(<UpbringingScreen />);
    await screen.findByRole("region", { name: "本月日程" });
    expect(screen.getByTestId("cell-0:lesson")).toBeDisabled();
    expect(screen.getByTestId("cell-1:after")).toBeDisabled();
    expect(screen.getByTestId("cell-2:lesson")).toBeEnabled();
  });

  it("周条上选停顿方式：存进应用设置的 upbringing_pause", async () => {
    const user = userEvent.setup();
    const calls = installIpc({
      upbringing: () => view(),
      get_settings: () => ({ ...settingsView, settings: { ...settingsView.settings, upbringing_pause: "week" } }),
    });
    render(<UpbringingScreen />);
    const pick = await screen.findByTestId("ub-week-pause");
    expect(pick).toHaveValue("week");
    await user.selectOptions(pick, "month");
    await waitFor(() => {
      const saved = calls.mock.calls.find(([n]) => n === "save_settings")?.[1] as { settings: { upbringing_pause: string } } | undefined;
      expect(saved?.settings.upbringing_pause).toBe("month");
    });
  });
});

afterAll(() => {
  applyUi("v1");
  useUiVersion.setState({ ui: "v1" });
});
