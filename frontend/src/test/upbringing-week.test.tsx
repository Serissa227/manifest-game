// 养成按周播放的周条（P10 的界面接线）：
// 这个月按周分段、周条的主按钮此刻该做什么（开始第 N 周 / 继续这一周 / 暂停 / 先看剧情），以及画面上的那一条。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import StoryDialog from "../components/story/StoryDialog";
import { useStoryUi } from "../components/story/storyKit";
import UpbringingScreen from "../components/upbringing/UpbringingScreen";
import { monthLastDay, monthWeeks, weekAction, WEEK_DAYS } from "../components/upbringing/ubKit";
import type { CaptainDefsView, StaticView, StoryView, UpbringingView } from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, overview, statics } from "./fixtures";

type Week = NonNullable<UpbringingView["week"]>;

/** 一份够画出主画面的养成视图（1553 年 5 月，31 天）。 */
function view(o: { phase?: "plan" | "running"; today?: number; week?: Week | null } = {}): UpbringingView {
  const phase = o.phase ?? "running";
  const today = o.today ?? 8;
  return {
    stage: "home",
    stage_name: "家乡 · 土佐中村",
    home: "土佐中村",
    academy: null,
    today: [1553, 5, today],
    week: o.week === undefined ? { number: 2, from: [1553, 5, 8], to: [1553, 5, 14] } : o.week,
    phase,
    protagonist: { key: "mio", name: "一条澪", age: 12, birthday: [6, 21], portrait: null, outfit: null, season: 0 },
    meters: {
      stamina: { value: 70, max: 100, label: "精神" },
      fatigue: { value: 20, max: 100, label: "不累" },
      mood: { value: 60, max: 100, label: "平常" },
      fame: { value: 10, max: 100, label: "无名" },
    },
    cash: 120,
    growth: [{ attr: "seamanship", value: 400, projected: 4 }],
    ratings: [],
    skills: [],
    plan: {
      month: [1553, 5],
      editable: phase === "plan",
      slots: [0, 1, 2].map((i) => ({
        index: i,
        label: ["上旬", "中旬", "下旬"][i],
        from: [1553, 5, i * 10 + 1] as [number, number, number],
        to: [1553, 5, i === 2 ? 31 : i * 10 + 10] as [number, number, number],
        lesson: null,
        after: phase === "running" ? { activity: "rest" } : null,
        status: phase === "running" ? (i === 0 ? ("current" as const) : ("planned" as const)) : ("empty" as const),
      })),
    },
    lessons: [],
    activities: [
      {
        key: "rest",
        name: "休息",
        desc: "",
        kind: "rest",
        scene: "home",
        cost: 0,
        income: [0, 0],
        fatigue: -20,
        mood: 4,
        gains: [],
        skills: [],
        mentor: null,
        companions: [],
        tier: null,
        risk: 0,
        needs: [],
        enabled: true,
        tags: [],
        new: false,
      },
    ],
    places: [],
    excursions: [],
    companions: [],
    calendar: [],
    exams: [],
    path: { choose_on: null, chosen: null, options: [] },
    memories: [],
    letters: [],
    diary: [],
    presets: [],
    last: [],
  };
}

describe("这个月按周分段（ubKit）", () => {
  it("一周七天，与后端的周界一致", () => {
    expect(WEEK_DAYS).toBe(7);
  });

  it("31 天的月份是五周，最后一周只到月末；今天所在的那一周是“这一周”", () => {
    expect(monthWeeks(31, 9)).toEqual([
      { number: 1, from: 1, to: 7, state: "done" },
      { number: 2, from: 8, to: 14, state: "current" },
      { number: 3, from: 15, to: 21, state: "upcoming" },
      { number: 4, from: 22, to: 28, state: "upcoming" },
      { number: 5, from: 29, to: 31, state: "upcoming" },
    ]);
    expect(monthWeeks(30, 30).map((w) => `${w.from}-${w.to}:${w.state}`).at(-1)).toBe("29-30:current");
  });

  it("28 天的月份正好四周；29 天的月份第五周只有一天", () => {
    expect(monthWeeks(28, 1).map((w) => [w.from, w.to])).toEqual([
      [1, 7],
      [8, 14],
      [15, 21],
      [22, 28],
    ]);
    expect(monthWeeks(29, 29).at(-1)).toEqual({ number: 5, from: 29, to: 29, state: "current" });
  });

  it("每一天都恰好落在一周里，周与周不重叠", () => {
    for (const last of [28, 29, 30, 31]) {
      const weeks = monthWeeks(last, 1);
      for (let d = 1; d <= last; d++) expect(weeks.filter((w) => d >= w.from && d <= w.to)).toHaveLength(1);
      expect(weeks.at(-1)?.to).toBe(last);
    }
  });

  it("这个月最后一天取本月日程最后一旬的末日", () => {
    expect(monthLastDay(view())).toBe(31);
    expect(monthLastDay({ plan: { month: [1553, 2], editable: true, slots: [] }, week: { number: 4, from: [1553, 2, 22], to: [1553, 2, 28] } })).toBe(28);
  });

  it("主按钮：停在一周开头是开始，过到一半是继续，在走是暂停；有收起的剧情先看剧情；月初排日程时不给按钮", () => {
    const at = (o: Parameters<typeof view>[0], paused: boolean, storyWaiting = false) => weekAction(view(o), { paused, storyWaiting });
    expect(at({ today: 8 }, true)).toBe("start");
    expect(at({ today: 11 }, true)).toBe("resume");
    expect(at({ today: 11 }, false)).toBe("pause");
    expect(at({ today: 8 }, true, true)).toBe("story");
    expect(at({ today: 11 }, false, true)).toBe("story");
    expect(at({ phase: "plan", today: 1, week: { number: 1, from: [1553, 5, 1], to: [1553, 5, 7] } }, true)).toBe("plan");
    expect(at({ phase: "plan", today: 1, week: { number: 1, from: [1553, 5, 1], to: [1553, 5, 7] } }, true, true)).toBe("story");
    // 不按周播放的世界（没有 week）
    expect(at({ week: null }, true)).toBeNull();
  });
});

describe("养成主画面的周条", () => {
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
    useStoryUi.setState({ dismissed: "", panel: false });
    useGame.setState({ statics: s, overview: paused, version: 1, error: null, message: null, runSpeed: 4 });
  });

  it("停在一周开头：写第几周与几号到几号、上一周过完了，主按钮“开始第 2 周”按上一次的倍速走起来", async () => {
    const user = userEvent.setup();
    const calls = installIpc({ upbringing: () => view({ today: 8 }), set_speed: () => ({ ...paused, speed: 4 }) });
    render(<UpbringingScreen />);
    const bar = await screen.findByTestId("ub-week");
    expect(bar).toHaveAttribute("data-action", "start");
    expect(within(bar).getByTestId("ub-week-no")).toHaveTextContent("第 2 周");
    expect(within(bar).getByTestId("ub-week-range")).toHaveTextContent("5 月 8 日 – 14 日");
    expect(within(bar).getByTestId("ub-week-note")).toHaveTextContent("第 1 周过完了。");
    // 这个月的五周：第一周过完、第二周是这一周
    const segs = within(bar).getAllByRole("listitem");
    expect(segs.map((e) => e.textContent)).toEqual(["1–7", "8–14", "15–21", "22–28", "29–31"]);
    expect(segs[0]).toHaveClass("is-done");
    expect(segs[1]).toHaveClass("is-current");
    expect(segs[1]).toHaveAttribute("aria-current", "step");
    expect(segs[2]).toHaveClass("is-upcoming");
    await user.click(within(bar).getByRole("button", { name: "开始第 2 周" }));
    await waitFor(() => expect(calls.mock.calls.filter(([name]) => name === "set_speed")).toHaveLength(1));
    expect(calls.mock.calls.find(([name]) => name === "set_speed")?.[1]).toEqual({ speed: 4 });
  });

  it("正在走：主按钮是安静的“暂停”，写明过完哪一天停一下；点了把倍速设成 0", async () => {
    const user = userEvent.setup();
    useGame.setState({ overview: { ...paused, speed: 4 } });
    const calls = installIpc({ upbringing: () => view({ today: 10 }), set_speed: () => paused });
    render(<UpbringingScreen />);
    const bar = await screen.findByTestId("ub-week");
    expect(bar).toHaveAttribute("data-action", "pause");
    expect(within(bar).getByTestId("ub-week-note")).toHaveTextContent("过完 14 日停一下。");
    const go = within(bar).getByTestId("ub-week-go");
    expect(go).toHaveTextContent("暂停");
    expect(go).not.toHaveClass("is-primary");
    await user.click(go);
    await waitFor(() => expect(calls.mock.calls.find(([name]) => name === "set_speed")?.[1]).toEqual({ speed: 0 }));
  });

  it("过到一半停下：“继续这一周”，写停在几号", async () => {
    installIpc({ upbringing: () => view({ today: 11 }) });
    render(<UpbringingScreen />);
    const bar = await screen.findByTestId("ub-week");
    expect(bar).toHaveAttribute("data-action", "resume");
    expect(within(bar).getByTestId("ub-week-note")).toHaveTextContent("停在 5 月 11 日。");
    expect(within(bar).getByTestId("ub-week-go")).toHaveClass("is-primary");
    expect(within(bar).getByRole("button", { name: "继续这一周" })).toBeInTheDocument();
  });

  it("有一段收起的剧情在等回应：主按钮先把它交还给玩家，不去动倍速", async () => {
    const user = userEvent.setup();
    const story: StoryView = {
      line: null,
      last: null,
      journal: [],
      pending: {
        day: 0,
        fleet: 0,
        kind: "chapter",
        key: "week_story",
        title: "待回答的剧情",
        text: "测试剧情。",
        speaker: { kind: "portrait", asset: "keeper-mediterranean-bank-a", name: "测试人物" },
        choices: [{ text: "回答剧情", cost: 0 }],
      },
    };
    useGame.setState({ overview: { ...paused, story } });
    const calls = installIpc({ upbringing: () => view({ today: 9 }) });
    render(
      <>
        <UpbringingScreen />
        <StoryDialog />
      </>,
    );
    await user.click(await screen.findByTestId("story-later"));
    expect(screen.queryByTestId("story-later")).toBeNull();
    const bar = screen.getByTestId("ub-week");
    await waitFor(() => expect(bar).toHaveAttribute("data-action", "story"));
    expect(within(bar).getByTestId("ub-week-note")).toHaveTextContent("有一段剧情在等你回应");
    await user.click(within(bar).getByRole("button", { name: "看剧情" }));
    expect(await screen.findByTestId("story-later")).toBeInTheDocument();
    expect(calls.mock.calls.filter(([name]) => name === "set_speed")).toHaveLength(0);
  });

  it("月初排日程：周条只写第 1 周与说明，不另给按钮（“开始这个月”就是第 1 周）", async () => {
    installIpc({ upbringing: () => view({ phase: "plan", today: 1, week: { number: 1, from: [1553, 5, 1], to: [1553, 5, 7] } }) });
    render(<UpbringingScreen />);
    const bar = await screen.findByTestId("ub-week");
    expect(bar).toHaveAttribute("data-action", "plan");
    expect(within(bar).getByTestId("ub-week-range")).toHaveTextContent("5 月 1 日 – 7 日");
    expect(within(bar).getByTestId("ub-week-note")).toHaveTextContent("排好这个月的日程就从第 1 周开始");
    expect(within(bar).queryByTestId("ub-week-go")).toBeNull();
    expect(screen.getByRole("button", { name: "开始这个月" })).toBeInTheDocument();
  });

  it("最后一周只有一天时写成一天", async () => {
    installIpc({ upbringing: () => view({ today: 29, week: { number: 5, from: [1553, 5, 29], to: [1553, 5, 29] } }) });
    render(<UpbringingScreen />);
    const bar = await screen.findByTestId("ub-week");
    expect(within(bar).getByTestId("ub-week-range")).toHaveTextContent("5 月 29 日");
    expect(within(bar).getByTestId("ub-week-range")).not.toHaveTextContent("–");
  });

  it("不按周播放的世界（视图里没有 week）不画周条", async () => {
    installIpc({ upbringing: () => view({ week: null }) });
    render(<UpbringingScreen />);
    await screen.findByRole("region", { name: "这个月进行中" });
    expect(screen.queryByTestId("ub-week")).toBeNull();
  });
});
