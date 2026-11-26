// FE2：见闻卡正文改读视图（卡上 text → 静态表 → 拼句）、“自动安排”排满后课表上方的旧提示、读档失败的两句人话。
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStoryUi } from "../components/story/storyKit";
import UpbringingScreen from "../components/upbringing/UpbringingScreen";
import { makeK3Names } from "../components/upbringing/act/k3Kit";
import type { ActNames } from "../components/upbringing/act/actKit";
import { loadFrom } from "../components/shell/saveSlots";
import type { ActivityView, CaptainDefsView, SlotView, StaticView, UpbringingView } from "../ipc/types";
import type { RumorCardView } from "../ipc/actTypes";
import { useGame } from "../store/game";
import { applyUi, useUiVersion } from "../ui/uiMode";
import { installIpc, overview, statics } from "./fixtures";

// —— 下面两个造视图的函数抄自 upbringing-weekly-u05.test.tsx（按周的学院期视图） ——
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


describe("FE2-1 见闻卡的正文", () => {
  const names = { line: (k: string) => k } as unknown as ActNames;
  const card: RumorCardView = { key: "rumor_sakai_paper_demand", port: "sakai", good: "paper", kind: "demand", valid: [[1553, 1, 1], [1558, 12, 30]], week: 1, expired: false };
  const k3 = (texts: Record<string, string>, c: RumorCardView) =>
    makeK3Names({ rumors: { cards: [c], goods: [] } }, { town: null }, names, texts, [{ key: "sakai", name: "堺" }], [{ key: "paper", name: "纸" }]);
  it("卡上有 text 时显示它", () => {
    const c = { ...card, text: "视图里的正文" };
    expect(k3({ "act:rumor:rumor_sakai_paper_demand": "静态表的正文" }, c).rumor(c)).toBe("视图里的正文");
    expect(k3({}, c).rumorKey(c.key)).toBe("视图里的正文");
  });
  it("卡上没有 text、静态表里有时显示静态表的", () => {
    expect(k3({ "act:rumor:rumor_sakai_paper_demand": "静态表的正文" }, card).rumor(card)).toBe("静态表的正文");
  });
  it("两处都没有时显示拼出来的那句", () => {
    expect(k3({}, card).rumor(card)).toBe("堺缺纸");
  });
});

describe("FE2-2 自动安排排满以后，课表上方的旧提示跟着当前课表", () => {
  const captain = { points: {}, signs: [], questions: [], attributes: [{ key: "seamanship", name: "航海", desc: "", group: "craft" }], groups: [] } as unknown as CaptainDefsView;
  const s: StaticView = { ...statics, captain };
  const paused = { ...overview, speed: 0, mode: "upbringing" as const };
  beforeEach(() => {
    applyUi("v2");
    useUiVersion.setState({ ui: "v2" });
    useStoryUi.setState({ dismissed: "", panel: false });
    useGame.setState({ statics: s, overview: paused, version: 1, error: null, message: null, runSpeed: 4 });
  });
  it("选预设前有“11 日的课余排不上：这一格还没有排” → 选了预设、课表排满 → 提示消失", async () => {
    const user = userEvent.setup();
    const v = view({ phase: "plan", plan: false, problem: { index: 3, reason: "这一格还没有排" } });
    v.plan.slots[3] = { ...v.plan.slots[3], timetable: { lesson: null, after: null } };
    installIpc({
      upbringing: () => v,
      auto_plan: () => ({ slots: [{ index: 3, after: { activity: "dock_work" } }] }),
    });
    render(<UpbringingScreen />);
    await screen.findByRole("region", { name: "本月日程" });
    expect(screen.getByText(/11 日的课余排不上：这一格还没有排/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "照上周" }));
    await waitFor(() => expect(screen.queryByText(/排不上：这一格还没有排/)).toBeNull());
  });
});

describe("FE2-3 读档失败的提示", () => {
  beforeEach(() => {
    useGame.setState({ error: null, message: null });
  });
  it("存档不存在：写“没有叫“save1”的存档”，后端原文只进控制台", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installIpc({ load_game: () => Promise.reject("存档读写失败：读取存档失败：系统找不到指定的文件。 (os error 2)") });
    await loadFrom("save1");
    expect(useGame.getState().error).toBe("没有叫“save1”的存档。眼下还是原来那一局。");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it("别的原因：写“读档“save1”没读成”，不接后端原文", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installIpc({ load_game: () => Promise.reject("存档读写失败：存档版本不兼容") });
    await loadFrom("save1");
    expect(useGame.getState().error).toBe("读档“save1”没读成，眼下还是原来那一局。");
    expect(useGame.getState().error).not.toMatch(/不兼容/);
    warn.mockRestore();
  });
});
