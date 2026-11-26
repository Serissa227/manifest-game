// 第九批养成主画面（docs/UI-CONTRACT.md I6）：日程草稿（家乡期一格、学院期两格）、补选、提交的 PlanMonth、预计收益与疲劳提醒、
// 分页（属性按组、羁绊的心动只在开放的人之间显示、日历倒计时）、自动日程、执行中的结算。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import UpbringingScreen from "../components/upbringing/UpbringingScreen";
import StoryDialog from "../components/story/StoryDialog";
import { useStoryUi } from "../components/story/storyKit";
import type { StoryView } from "../ipc/types";
import Tutorial from "../components/tutorial/Tutorial";
import {
  resetUbTutorial,
  useTutorial,
  useUbTutorial,
} from "../components/tutorial/tutorialState";
import {
  applySlots,
  assign,
  cellsOf,
  draftOf,
  fatigueWarning,
  isComplete,
  meterTone,
  missingNeeds,
  project,
  refine,
  SCENE_ART,
  sceneArtPath,
  toSlots,
  upcoming,
} from "../components/upbringing/ubKit";
import { SCENE_FILES } from "../components/upbringing/sceneAssets";
import type {
  ActivityView,
  CaptainDefsView,
  StaticView,
  UpbringingView,
} from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, overview, statics } from "./fixtures";

const act = (
  o: Partial<ActivityView> & Pick<ActivityView, "key" | "name" | "kind">,
): ActivityView => ({
  desc: "",
  scene: "dock",
  cost: 0,
  income: [0, 0],
  fatigue: 6,
  mood: 0,
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
  ...o,
});

function view(
  stage: "home" | "academy" = "home",
  phase: "plan" | "running" = "plan",
): UpbringingView {
  return {
    stage,
    stage_name: stage === "home" ? "家乡 · 土佐中村" : "学院 · 第一年",
    home: "土佐中村",
    academy: null,
    today: [1553, 5, 1],
    phase,
    protagonist: {
      key: "mio",
      name: "一条澪",
      age: 12,
      birthday: [6, 21],
      portrait: null,
      outfit: null,
      season: 0,
    },
    meters: {
      stamina: { value: 70, max: 100, label: "精神" },
      fatigue: { value: 60, max: 100, label: "有点累" },
      mood: { value: 20, max: 100, label: "低落" },
      fame: { value: 10, max: 100, label: "无名" },
    },
    cash: 120,
    growth: [
      { attr: "seamanship", value: 400, projected: 4 },
      { attr: "commerce", value: 100, projected: 1 },
    ],
    ratings: [{ key: "naval", name: "海战", value: 30, rank: "见习" }],
    skills: [],
    plan: {
      month: [1553, 5],
      editable: phase === "plan",
      slots: [0, 1, 2].map((i) => ({
        index: i,
        label: ["上旬", "中旬", "下旬"][i],
        from: [1553, 5, i * 10 + 1] as [number, number, number],
        to: [1553, 5, i * 10 + 10] as [number, number, number],
        lesson: null,
        after: phase === "running" ? { activity: "dock" } : null,
        status:
          phase === "running"
            ? i === 0
              ? "done"
              : i === 1
                ? "current"
                : "planned"
            : "empty",
        result:
          phase === "running" && i === 0
            ? {
                index: 0,
                title: "码头搬运",
                scene: "dock",
                success: true,
                growth: [{ attr: "seamanship", delta: 7 }],
                skills: [],
                cash: 30,
                fatigue: 8,
                mood: 0,
                affinity: [{ person: "ushio", name: "汐", delta: 2 }],
                items: [],
                line: "不错。",
              }
            : undefined,
      })),
    },
    lessons:
      stage === "academy"
        ? [
            act({
              key: "latin",
              name: "拉丁文",
              kind: "lesson",
              gains: [{ attr: "commerce", range: [4, 8] }],
            }),
          ]
        : [],
    activities: [
      act({
        key: "dock",
        name: "码头搬运",
        kind: "job",
        gains: [{ attr: "seamanship", range: [6, 10] }],
        income: [20, 40],
        fatigue: 10,
      }),
      act({
        key: "outing",
        name: "约人出去",
        kind: "date",
        needs: ["companion", "place"],
        fatigue: 2,
        mood: 6,
      }),
      act({ key: "rest", name: "休息", kind: "rest", fatigue: -20, mood: 4 }),
      act({
        key: "smuggle",
        name: "跑腿送货",
        kind: "job",
        enabled: false,
        blocked_reason: "要先认识林家的表哥",
      }),
    ],
    places: [
      {
        key: "market",
        name: "市集",
        x: 50,
        y: 50,
        kind: "market",
        open: true,
        people: [{ key: "ushio", name: "汐", portrait: null }],
        hint: null,
      },
    ],
    excursions: [],
    companions: [
      {
        key: "ushio",
        name: "汐",
        portrait: null,
        role: "family",
        bond: "B",
        affinity: 60,
        heart: 30,
        heart_stage: 1,
        romance_open: true,
        relation: ["乳姐妹"],
        call_name: "姬样",
        birthday: [6, 21],
        days_to_birthday: 51,
        likes_known: ["鲣鱼干"],
        dislikes_known: [],
        where_now: "港口",
        next_hint: null,
      },
      {
        key: "ase",
        name: "乳母阿濑",
        portrait: null,
        role: "mentor",
        summary: "能岛村上家出身的乳母，水练师傅",
        bond: "A",
        affinity: 80,
        heart: null,
        heart_stage: null,
        romance_open: false,
        relation: ["乳母"],
        call_name: "姬样",
        birthday: [2, 3],
        days_to_birthday: 278,
        likes_known: [],
        dislikes_known: [],
        where_now: null,
        next_hint: null,
      },
    ],
    calendar: [
      {
        date: [1553, 7, 7],
        days_left: 67,
        kind: "festival",
        key: "tanabata",
        name: "七夕",
        heart: true,
        note: null,
      },
      {
        date: [1553, 5, 5],
        days_left: 4,
        kind: "festival",
        key: "tango",
        name: "端午",
        heart: false,
        note: null,
      },
    ],
    exams: [],
    path: { choose_on: null, chosen: null, options: [] },
    memories: [],
    letters: [],
    diary: [],
    presets: [{ key: "sea", name: "偏重航海" }],
    last: [],
  };
}

describe("养成的日程草稿", () => {
  it("家乡期每旬一格、学院期每旬两格（课业在前）", () => {
    expect(cellsOf(view("home")).map((c) => `${c.index}${c.part}`)).toEqual([
      "0after",
      "1after",
      "2after",
    ]);
    expect(cellsOf(view("academy")).map((c) => `${c.index}${c.part}`)).toEqual([
      "0lesson",
      "0after",
      "1lesson",
      "1after",
      "2lesson",
      "2after",
    ]);
  });

  it("排满才算完成；需要补选的活动补齐才算；提交的段家乡期不带 lesson", () => {
    const v = view();
    let d = draftOf(v.plan);
    expect(isComplete(v, d)).toBe(false);
    d = assign(d, { index: 0, part: "after" }, "dock");
    d = assign(d, { index: 1, part: "after" }, "rest");
    d = assign(d, { index: 2, part: "after" }, "outing");
    expect(isComplete(v, d)).toBe(false);
    expect(missingNeeds(d.after[2] ?? null, v.activities[1])).toEqual([
      "companion",
      "place",
    ]);
    d = refine(d, 2, { companion: "ushio", place: "market" });
    expect(isComplete(v, d)).toBe(true);
    expect(toSlots(v, d)).toEqual([
      { index: 0, after: { activity: "dock" } },
      { index: 1, after: { activity: "rest" } },
      {
        index: 2,
        after: { activity: "outing", companion: "ushio", place: "market" },
      },
    ]);
  });

  it("学院期提交带课业；自动日程只改给出的格子", () => {
    const v = view("academy");
    let d = draftOf(v.plan);
    d = applySlots(d, [
      { index: 0, lesson: "latin", after: { activity: "dock" } },
      { index: 1, lesson: "latin" },
    ]);
    expect(d.lesson[0]).toBe("latin");
    expect(d.after[1]).toBeNull();
    expect(toSlots(v, d)[0]).toEqual({
      index: 0,
      lesson: "latin",
      after: { activity: "dock" },
    });
  });

  it("预计：成长取区间中点之和，零用钱为收入中点减花费；疲劳到八成时提醒", () => {
    const v = view();
    let d = draftOf(v.plan);
    d = assign(d, { index: 0, part: "after" }, "dock");
    d = assign(d, { index: 1, part: "after" }, "dock");
    const p = project(v, d);
    expect(p.growth.get("seamanship")).toBe(16);
    expect(p.cash).toBe(60);
    expect(p.fatigue).toBe(20);
    expect(fatigueWarning(v.meters.fatigue, p.fatigue)).toBe(true);
    expect(fatigueWarning(v.meters.fatigue, 0)).toBe(false);
  });

  it("数值条的色调与倒计时的顺序", () => {
    const v = view();
    expect(meterTone("fatigue", v.meters.fatigue)).toBe("warn");
    expect(meterTone("mood", v.meters.mood)).toBe("bad");
    expect(meterTone("stamina", v.meters.stamina)).toBe("good");
    expect(upcoming(v.calendar, 3).map((m) => m.key)).toEqual([
      "tango",
      "tanabata",
    ]);
  });

  it("场景插画：清单里的 key 直接用，小格用缩略图；通用 key 借同类插画；没有插画的为 null", () => {
    expect(SCENE_FILES.length).toBeGreaterThan(0);
    const k = SCENE_FILES[0];
    expect(sceneArtPath(k, "large")).toBe(`scenes/${k}.webp`);
    expect(sceneArtPath(k, "small")).toBe(`scenes/${k}-s.webp`);
    for (const v of Object.values(SCENE_ART)) expect(SCENE_FILES).toContain(v);
    expect(sceneArtPath("no_such_scene", "large")).toBeNull();
    expect(sceneArtPath("toString", "small")).toBeNull();
  });
});

describe("养成主画面", () => {
  const captain = {
    points: {},
    signs: [],
    questions: [],
    attributes: [
      { key: "seamanship", name: "航海", desc: "", group: "craft" },
      { key: "commerce", name: "交易", desc: "", group: "craft" },
    ],
    groups: [
      {
        key: "craft",
        name: "本领",
        range: [1, 10],
        start: 1,
        free: 8,
        creation_cap: 7,
      },
    ],
  } as unknown as CaptainDefsView;
  const s: StaticView = { ...statics, captain };

  beforeEach(() => {
    useStoryUi.setState({ dismissed: "", panel: false });
    useGame.setState({
      statics: s,
      overview: { ...overview, speed: 0, mode: "upbringing" },
      version: 1,
      error: null,
      message: null,
    });
  });

  it("养成剧情稍后再说以后，可用故事入口或播放键回来回答", async () => {
    const user = userEvent.setup();
    const story: StoryView = {
      line: null, last: null, journal: [],
      pending: { day: 0, fleet: 0, kind: "chapter", key: "pause_recovery", title: "待回答的剧情", text: "测试剧情。",
        speaker: { kind: "portrait", asset: "keeper-mediterranean-bank-a", name: "测试人物" },
        choices: [{ text: "回答剧情", cost: 0 }] },
    };
    const current = { ...overview, mode: "upbringing" as const, speed: 0, story };
    useGame.setState({ overview: current });
    const calls = installIpc({ upbringing: () => view("home", "running"),
      submit: () => ({ outcome: "Done", overview: { ...current, story: { ...story, pending: null } } }) });
    render(<><UpbringingScreen /><StoryDialog /></>);
    await screen.findByTestId("story-later");
    await user.click(screen.getByTestId("story-later"));
    expect(screen.queryByTestId("story-later")).toBeNull();
    await user.click(screen.getByTestId("story-button"));
    await user.click(screen.getByTestId("story-reopen"));
    await user.click(screen.getByTestId("story-later"));
    await user.click(screen.getByRole("button", { name: "继续" }));
    await user.click(await screen.findByRole("button", { name: /回答剧情/ }));
    await waitFor(() => expect(useGame.getState().overview?.story?.pending).toBeNull());
    expect(calls.mock.calls.filter(([name]) => name === "submit")).toHaveLength(1);
    expect(calls.mock.calls.filter(([name]) => name === "set_speed")).toHaveLength(0);
  });

  it("回忆相册：有插画的回忆显示缩略画（按那一天的月份挑季节版），没有的照旧是一块底色", async () => {
    const user = userEvent.setup();
    const memories: UpbringingView["memories"] = [
      {
        key: "m1",
        title: "蹴鞠",
        date: [1554, 1, 10],
        art: "kemari_jp",
        line: "",
      },
      {
        key: "m2",
        title: "河口潮流竞渡",
        date: [1555, 6, 1],
        art: "mem-c9-mio-03",
        line: "",
      },
      {
        key: "m3",
        title: "没有图的回忆",
        date: [1555, 7, 1],
        art: null,
        line: "",
      },
    ];
    installIpc({ upbringing: () => ({ ...view(), memories }) });
    render(<UpbringingScreen />);
    await screen.findByText("家乡 · 土佐中村");
    await user.click(screen.getByRole("tab", { name: "相册" }));
    const arts = await screen.findAllByTestId("memory-art");
    expect(arts.map((a) => a.getAttribute("src"))).toEqual([
      expect.stringMatching(/scenes\/kemari_jp--winter-s\.webp$/),
      expect.stringMatching(/scenes\/mem-c9-mio-03-s\.webp$/),
    ]);
  });

  it("U04 比赛报名：30 天内的比赛有“报名”，报了写还有几天；少年组标出来", async () => {
    const user = userEvent.setup();
    const contests: UpbringingView["contests"] = [
      {
        key: "c_pearls@1553-09-20",
        name: "采珠",
        kind: "identify",
        date: [1553, 9, 20],
        status: "open",
        prep: 0,
        result: null,
        registered: false,
        can_register: true,
        days_left: 12,
        junior: true,
      },
      {
        key: "c_poem@1553-09-25",
        name: "歌合",
        kind: "poem",
        date: [1553, 9, 25],
        status: "open",
        prep: 0,
        result: null,
        registered: true,
        can_register: false,
        days_left: 17,
      },
    ];
    const calls = installIpc({
      upbringing: () => ({ ...view(), contests }),
      submit: () => ({
        outcome: "Done",
        overview: { ...overview, speed: 0, mode: "upbringing" },
      }),
    });
    render(<UpbringingScreen />);
    await screen.findByText("家乡 · 土佐中村");
    const list = screen.getByRole("list", { name: "比赛" });
    const [pearls, poem] = within(list).getAllByRole("listitem");
    expect(pearls).toHaveTextContent("少年组");
    expect(poem).toHaveTextContent("已报名 · 还有 17 天");
    expect(within(poem).queryByRole("button", { name: "报名" })).toBeNull();
    await user.click(within(pearls).getByRole("button", { name: "报名" }));
    expect(calls).toHaveBeenCalledWith("submit", {
      command: {
        PlayContest: {
          owner: "player",
          contest: "c_pearls@1553-09-20",
          moves: { register: true },
        },
      },
    });
  });

  it("U04：心情小标、新开放提示、解锁差项与“差一点”、折叠计数、年度目标卡", async () => {
    const user = userEvent.setup();
    const base = view();
    installIpc({
      upbringing: () => ({
        ...base,
        meters: {
          ...base.meters,
          mood: { value: 85, max: 100, label: "心情", center: 50, high: 80, low: 20, high_bonus_pct: 10, boosted: true, low_mood: false, efficiency_pct: 110 },
        },
        activities: [
          ...base.activities,
          act({
            key: "u04_unlock_mio_5",
            name: "小早操舵",
            kind: "training",
            enabled: false,
            blocked_reason: "还没开放",
            unlock_gap: [{ key: "skill:court_etiquette", label: "礼仪", have: 120, need: 144 }],
            near: true,
          }),
          act({ key: "u04_unlock_mio_6", name: "u04_unlock_mio_6", kind: "training", placeholder: true }),
        ],
        hidden_count: 3,
        hidden_lessons: 0,
        unlocked_now: [{ kind: "activity", key: "u04_unlock_mio_1", label: "誊星簿", rank: null, date: [1553, 4, 1] }],
        goals: {
          year: 1553,
          items: [
            {
              key: "u04_goal_mio_1553_1",
              year: 1553,
              text: null,
              fallback_code: "upbringing.goal_generic",
              status: "active",
              since: [1553, 1, 1],
              done_date: null,
              objectives: [{ key: "growth:etiquette", label: "礼仪", have: 310, need: 337, done: false }],
              rewards: [{ kind: "growth", key: "etiquette", label: "礼仪", value: 5 }],
            },
            {
              key: "u04_goal_mio_1553_3",
              year: 1553,
              text: "攒下买一只笔匣的钱",
              fallback_code: "upbringing.goal_generic",
              status: "done",
              since: [1553, 1, 1],
              done_date: [1553, 4, 28],
              objectives: [{ key: "cash", label: "现款", have: 300, need: 260, done: true }],
              rewards: [{ kind: "item", key: "quill_case", label: "笔匣", value: 1 }],
            },
          ],
          history: [],
          done_now: ["u04_goal_mio_1553_3"],
        },
      }),
    });
    render(<UpbringingScreen />);
    await screen.findByText("家乡 · 土佐中村");
    const mood = screen.getByTestId("meter-mood");
    expect(mood).toHaveTextContent("兴致高 +10%");
    expect(mood.getAttribute("title")).toContain("到 80 以上兴致高");
    const unlocked = screen.getByTestId("ub-unlocked");
    expect(unlocked).toHaveTextContent("完成了年度目标：攒下买一只笔匣的钱");
    expect(unlocked).toHaveTextContent("新练习开放：誊星簿");
    expect(screen.getByTestId("act-u04_unlock_mio_5")).toHaveTextContent("差一点");
    expect(screen.getByTestId("gap-u04_unlock_mio_5")).toHaveTextContent("还差：礼仪 120 / 144");
    expect(screen.getByTestId("act-u04_unlock_mio_6")).toHaveTextContent("（还没起名的练习）");
    expect(screen.getByTestId("ub-hidden-count")).toHaveTextContent("另有 3 项这一局排不上");
    await user.click(screen.getByRole("tab", { name: "志向" }));
    const goals = screen.getByTestId("ub-goals");
    expect(goals).toHaveTextContent("1553 年的小目标");
    // 文字为空时回退通用语；进度不超过需要；奖励写成人话
    expect(goals).toHaveTextContent("这一年的小目标");
    expect(goals).toHaveTextContent("礼仪 310 / 337");
    expect(goals).toHaveTextContent("奖励：礼仪 +5");
    expect(goals).toHaveTextContent("现款 260 / 260");
    expect(goals).toHaveTextContent("完成了");
  });

  it("点格子再点活动卡片排日程，补选同伴与地点，提交 PlanMonth", async () => {
    const user = userEvent.setup();
    const calls = installIpc({
      upbringing: () => view(),
      submit: () => ({
        outcome: "Done",
        overview: { ...overview, speed: 0, mode: "upbringing" },
      }),
    });
    render(<UpbringingScreen />);
    await screen.findByText("家乡 · 土佐中村");
    const go = screen.getByRole("button", { name: "开始这个月" });
    expect(go).toBeDisabled();
    // 第一格缺省选中：放码头搬运，选中移到下一个空格
    await user.click(
      within(screen.getByTestId("act-dock")).getByRole("button"),
    );
    await user.click(
      within(screen.getByTestId("act-rest")).getByRole("button"),
    );
    await user.click(
      within(screen.getByTestId("act-outing")).getByRole("button"),
    );
    expect(screen.getByTestId("cell-2:after")).toHaveTextContent("约人出去");
    expect(go).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("和谁"), "ushio");
    await user.selectOptions(screen.getByLabelText("去哪里"), "market");
    expect(go).toBeEnabled();
    // 不能选的活动写明原因
    expect(
      within(screen.getByTestId("act-smuggle")).getByRole("button"),
    ).toBeDisabled();
    expect(screen.getByText("要先认识林家的表哥")).toBeInTheDocument();
    await user.click(go);
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: {
          PlanMonth: {
            owner: "player",
            slots: [
              { index: 0, after: { activity: "dock" } },
              { index: 1, after: { activity: "rest" } },
              {
                index: 2,
                after: {
                  activity: "outing",
                  companion: "ushio",
                  place: "market",
                },
              },
            ],
          },
        },
      }),
    );
  });

  it("自动日程把结果填进日程表；预计收益写在底栏", async () => {
    const user = userEvent.setup();
    installIpc({
      upbringing: () => view(),
      auto_plan: () => ({
        slots: [0, 1, 2].map((i) => ({
          index: i,
          after: { activity: "dock" },
        })),
      }),
    });
    render(<UpbringingScreen />);
    await screen.findByText("家乡 · 土佐中村");
    await user.selectOptions(screen.getByLabelText("自动安排"), "sea");
    await waitFor(() =>
      expect(screen.getByTestId("cell-2:after")).toHaveTextContent("码头搬运"),
    );
    expect(screen.getByTestId("ub-projection")).toHaveTextContent("航海 +24");
    expect(screen.getByTestId("ub-projection")).toHaveTextContent(
      "这样排会太累",
    );
  });

  it("分页：属性按组；羁绊里心动只在开放的人身上显示；日历按倒计时", async () => {
    const user = userEvent.setup();
    installIpc({ upbringing: () => view() });
    render(<UpbringingScreen />);
    await screen.findByText("家乡 · 土佐中村");
    expect(screen.getByRole("region", { name: "本领" })).toHaveTextContent(
      "航海",
    );
    await user.click(screen.getByRole("tab", { name: "羁绊" }));
    const ushio = document.querySelector(
      '[data-person="ushio"]',
    ) as HTMLElement;
    const ase = document.querySelector('[data-person="ase"]') as HTMLElement;
    expect(within(ushio).getByLabelText("在意")).toBeInTheDocument();
    expect(
      within(ase).queryByLabelText(/在意|心动|心照不宣/),
    ).not.toBeInTheDocument();
    // 一句话身份：这个人是谁、做什么（没有简介的不写这一行）
    expect(within(ase).getByText("能岛村上家出身的乳母，水练师傅")).toHaveClass(
      "ub-bond-summary",
    );
    expect(ushio.querySelector(".ub-bond-summary")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "日历" }));
    const items = screen.getAllByText(/天后$/).map((x) => x.textContent);
    expect(items).toEqual(["4 天后", "67 天后"]);
  });

  it("K01 技能效果：生效中的这一级与下一级分开写；被上限压住、暂无作用、还没到 1 级的分别标出", async () => {
    const line = (kind: string, text: string, live = true, capped: number | null = null) => ({ kind, text, live, capped });
    installIpc({
      upbringing: () => ({
        ...view(),
        skills: [
          { key: "astral", name: "天文航法", level: 2, xp: 220, next: 360,
            effects: { enabled: true, now: [line("find_pct", "发现物探查 +6%")], next_level: 3, next: [line("find_pct", "发现物探查 +9%")] } },
          { key: "haggle", name: "谈判", level: 2, xp: 190, next: 360,
            effects: { enabled: true, now: [line("bargain_pct", "议价 +4%", true, 50)], next_level: 3, next: [line("bargain_pct", "议价 +6%")] } },
          { key: "chart", name: "绘图", level: 3, xp: 400, next: 360,
            effects: { enabled: true, now: [line("chart_reveal", "海图揭示 +3", false)], next_level: null, next: [] } },
          { key: "tide", name: "读潮", level: 0, xp: 20, next: 60,
            effects: { enabled: true, now: [], next_level: 1, next: [line("landing_pct", "登陆 +3%")] } },
          { key: "plain", name: "没有效果的技能", level: 1, xp: 70, next: 180 },
        ],
      }),
    });
    render(<UpbringingScreen />);
    await screen.findByText("家乡 · 土佐中村");
    const row = (name: string) => screen.getByText(name).closest("li") as HTMLElement;
    const astral = row("天文航法");
    expect(astral.querySelector(".ub-skill-fx-now")).toHaveTextContent("生效发现物探查 +6%");
    expect(astral.querySelector(".ub-skill-fx-next")).toHaveTextContent("3 级发现物探查 +9%");
    expect(row("谈判").querySelector(".ub-skill-fx-now")).toHaveTextContent("议价 +4%（已到上限，同类合计实得 50%）");
    expect(row("绘图").querySelector(".ub-skill-fx-now")).toHaveTextContent("海图揭示 +3（暂无作用）");
    expect(row("绘图").querySelector(".ub-skill-fx-next")).toBeNull();
    expect(row("读潮").querySelector(".ub-skill-fx-now")).toBeNull();
    expect(row("读潮").querySelector(".ub-skill-fx-next")).toHaveTextContent("1 级起登陆 +3%");
    expect(row("没有效果的技能").querySelector(".ub-skill-fx")).toBeNull();
  });

  it("跳过剩余养成：先确认（取消不提交），确认后提交 SkipUpbringing，概览回到出海", async () => {
    const user = userEvent.setup();
    const calls = installIpc({
      upbringing: () => view(),
      submit: () => ({
        outcome: "Done",
        overview: { ...overview, speed: 0, mode: "voyage" },
      }),
    });
    const submits = () =>
      calls.mock.calls
        .filter(([c]) => c === "submit")
        .map(([, a]) => a.command);
    render(<UpbringingScreen />);
    await screen.findByText("家乡 · 土佐中村");
    const skip = screen.getByRole("button", { name: "跳过剩余养成" });
    expect(skip).toBeEnabled();
    await user.click(skip);
    const ask = screen.getByRole("alertdialog", { name: "跳过剩下的养成？" });
    expect(ask).toHaveTextContent("跳过之后回不到养成");
    await user.click(within(ask).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(submits()).toEqual([]);
    await user.click(skip);
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "跳过，直接结业",
      }),
    );
    await waitFor(() =>
      expect(submits()).toEqual([{ SkipUpbringing: { owner: "player" } }]),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(useGame.getState().overview?.mode).toBe("voyage");
  });

  it("菜单：存档、读档与回主菜单（养成期也能存读档、离开）", async () => {
    const user = userEvent.setup();
    const calls = installIpc({
      upbringing: () => view(),
      save_game: () => ({ slot: "save1" }),
      set_speed: () => ({ ...overview, speed: 0, mode: "upbringing" }),
    });
    render(<UpbringingScreen />);
    await screen.findByText("家乡 · 土佐中村");
    const menu = screen.getByRole("button", { name: "主菜单" });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    await user.click(menu);
    const pop = screen.getByTestId("ub-menu-pop");
    expect(within(pop).getByRole("textbox", { name: "存档名" })).toHaveValue(
      "save1",
    );
    await user.click(within(pop).getByRole("button", { name: "存档" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("save_game", { slot: "save1" }),
    );
    await waitFor(() => expect(useGame.getState().message).toContain("已存档"));
    expect(within(pop).getByRole("button", { name: "读档" })).toBeEnabled();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("ub-menu-pop")).toBeNull();
    await user.click(menu);
    // 回主菜单先确认（11-03）：取消就还在这一局，点“回到主菜单”才离开
    await user.click(
      screen.getByRole("button", { name: "回到主菜单（不存档）" }),
    );
    const ask = await screen.findByRole("alertdialog", {
      name: "回到主菜单？",
    });
    expect(ask).toHaveTextContent("没存档的进度会丢掉");
    await user.click(within(ask).getByRole("button", { name: "取消" }));
    expect(useGame.getState().overview).not.toBeNull();
    if (!screen.queryByTestId("ub-menu-pop")) await user.click(menu);
    await user.click(
      screen.getByRole("button", { name: "回到主菜单（不存档）" }),
    );
    await user.click(
      within(
        await screen.findByRole("alertdialog", { name: "回到主菜单？" }),
      ).getByRole("button", { name: "回到主菜单" }),
    );
    expect(useGame.getState().overview).toBeNull();
  });

  it("结业以后（done）“跳过剩余养成”不可用", async () => {
    installIpc({ upbringing: () => ({ ...view(), phase: "done" }) });
    render(<UpbringingScreen />);
    await screen.findByText("家乡 · 土佐中村");
    expect(screen.getByRole("button", { name: "跳过剩余养成" })).toBeDisabled();
  });

  it("U04 结业摘要：结局正文、另得的称号、差一点走到的结局各差什么", async () => {
    installIpc({
      upbringing: () => ({
        ...view(),
        phase: "done",
        ending: { key: "c9_mio_ending_09", title: "水军大将", text: "船出了河口。" },
        supplementary: [{ key: "c9_mio_ending_06", title: "岬南那块空纸", text: "…" }],
        near_miss: [
          {
            ending: "c9_mio_ending_10",
            title: "海商",
            missing: [
              { key: "rating:mercantile", label: "商才", have: 312, need: 340 },
              { key: "exam:exam_kyoto_court", label: "宫中考", have: 0, need: 1 },
            ],
          },
          { ending: "c9_mio_ending_11", title: null, missing: [{ key: "flag:c9_mio_omen_1", label: null, have: 0, need: 1 }] },
        ],
      }),
    });
    render(<UpbringingScreen />);
    const summary = await screen.findByTestId("ub-summary");
    expect(summary).toHaveTextContent("水军大将");
    expect(summary).toHaveTextContent("船出了河口。");
    expect(summary).toHaveTextContent("另得的称号：岬南那块空纸");
    expect(summary).toHaveTextContent("海商：商才 312 / 340、宫中考（还没做到）");
    expect(summary).toHaveTextContent("另一个结局：有一段剧情没走到");
  });

  it("执行中：画这一旬的场景，结完的一旬写结算与评语", async () => {
    installIpc({ upbringing: () => view("home", "running") });
    render(<UpbringingScreen />);
    const running = await screen.findByRole("region", { name: "这个月进行中" });
    expect(running).toHaveTextContent("航海 +7");
    expect(running).toHaveTextContent("汐情谊 +2");
    expect(running).toHaveTextContent("不错。");
    expect(
      screen.queryByRole("button", { name: "开始这个月" }),
    ).not.toBeInTheDocument();
  });
});

describe("养成教程", () => {
  beforeEach(() => {
    resetUbTutorial();
    useGame.setState({
      statics,
      overview: { ...overview, mode: "upbringing" },
      version: 1,
    });
  });

  it("养成中、没看过时自动开始；走完记下看过，出海的教程不受影响", async () => {
    const user = userEvent.setup();
    installIpc();
    render(<Tutorial track="upbringing" />);
    const layer = await screen.findByTestId("tutorial");
    expect(layer).toHaveAttribute("data-step", "ub_welcome");
    expect(screen.getByText("长大以前")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "跳过教程" }));
    expect(useUbTutorial.getState().done).toBe(true);
    expect(useTutorial.getState().active).toBe(false);
  });

  it("不在养成中时不出现", () => {
    useGame.setState({ overview: { ...overview, mode: "voyage" } });
    installIpc();
    render(<Tutorial track="upbringing" />);
    expect(screen.queryByTestId("tutorial")).not.toBeInTheDocument();
  });
});
