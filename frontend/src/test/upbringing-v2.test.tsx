// 养成主画面的新界面（v2，docs/UI-REDESIGN.md 第 8、9 节）：只在 v2 下加的小结构与行为——
// 活动卡上面的“点一张卡，排进……”、底栏的“本月预计”小签、开始键按不了时就地写原因与补救（跳到那一格 / 焦点落在要补选的下拉框）、
// 分类在课业格与课后格之间切换时不留空列表、右栏空着的分页用共用的空状态；以及旧界面（v1）维持原样（没有这些结构、没有 v2 的类）。
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import UpbringingScreen from "../components/upbringing/UpbringingScreen";
import { setLocale } from "../i18n/locale";
import type { ActivityView, CaptainDefsView, StaticView, UpbringingView } from "../ipc/types";
import { useGame } from "../store/game";
import { applyUi, useUiVersion } from "../ui/uiMode";
import { installIpc, overview, statics } from "./fixtures";

function setUiFor(ui: "v1" | "v2") {
  applyUi(ui);
  useUiVersion.setState({ ui });
}

/** 页面里 v2 开头的类。 */
const v2Classes = () => [...document.querySelectorAll("[class]")].flatMap((el) => [...el.classList]).filter((c) => /^v2(-|$)/.test(c));

const act = (o: Partial<ActivityView> & Pick<ActivityView, "key" | "name" | "kind">): ActivityView => ({
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

function view(stage: "home" | "academy" = "home"): UpbringingView {
  return {
    stage,
    stage_name: stage === "home" ? "家乡 · 土佐中村" : "学院 · 第一年",
    home: "土佐中村",
    academy: null,
    today: [1553, 5, 1],
    phase: "plan",
    protagonist: { key: "mio", name: "一条澪", age: 12, birthday: [6, 21], portrait: null, outfit: null, season: 0 },
    meters: {
      stamina: { value: 70, max: 100, label: "精神" },
      fatigue: { value: 20, max: 100, label: "还好" },
      mood: { value: 60, max: 100, label: "雀跃" },
      fame: { value: 10, max: 100, label: "无名" },
    },
    cash: 120,
    growth: [{ attr: "seamanship", value: 400, projected: 4 }],
    ratings: [],
    skills: [],
    plan: {
      month: [1553, 5],
      editable: true,
      slots: [0, 1, 2].map((i) => ({
        index: i,
        label: ["上旬", "中旬", "下旬"][i],
        from: [1553, 5, i * 10 + 1] as [number, number, number],
        to: [1553, 5, i * 10 + 10] as [number, number, number],
        lesson: null,
        after: null,
        status: "empty" as const,
      })),
    },
    lessons: stage === "academy" ? [act({ key: "latin", name: "拉丁文", kind: "lesson", gains: [{ attr: "commerce", range: [4, 8] }] })] : [],
    activities: [
      act({ key: "dock", name: "码头搬运", kind: "job", gains: [{ attr: "seamanship", range: [6, 10] }], income: [20, 40], fatigue: 10 }),
      act({ key: "outing", name: "约人出去", kind: "date", needs: ["companion", "place"], fatigue: 2, mood: 6 }),
      act({ key: "rest", name: "休息", kind: "rest", fatigue: -20, mood: 4 }),
    ],
    places: [{ key: "market", name: "市集", x: 50, y: 50, kind: "market", open: true, people: [], hint: null }],
    excursions: [],
    companions: [
      { key: "ushio", name: "汐", portrait: null, role: "family", bond: "B", affinity: 60, heart: null, heart_stage: null, romance_open: false, relation: [], call_name: "姬样", birthday: [6, 21], days_to_birthday: 51, likes_known: [], dislikes_known: [], where_now: null, next_hint: null },
    ],
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

const captain = {
  points: {},
  signs: [],
  questions: [],
  attributes: [
    { key: "seamanship", name: "航海", desc: "" },
    { key: "commerce", name: "交易", desc: "" },
  ],
} as unknown as CaptainDefsView;
const s: StaticView = { ...statics, captain };

const pickCard = async (user: ReturnType<typeof userEvent.setup>, key: string) => user.click(within(screen.getByTestId(`act-${key}`)).getByRole("button"));

beforeEach(() => {
  setLocale("zh-CN");
  useGame.setState({ statics: s, overview: { ...overview, speed: 0, mode: "upbringing" }, version: 1, error: null, message: null });
});
afterEach(() => {
  cleanup();
  setUiFor("v1");
});

it.each(["v1", "v2"] as const)("比赛很多时列表可以获得键盘焦点，末项仍能报名（%s）", async (ui) => {
  setUiFor(ui);
  const user = userEvent.setup();
  const contests: UpbringingView["contests"] = Array.from({ length: 24 }, (_, i) => ({
    key: `contest_${i}`,
    name: `比赛 ${i + 1}`,
    kind: "poem",
    date: [1553, 5, 20],
    status: "open",
    prep: 0,
    result: null,
    registered: false,
    can_register: true,
    days_left: 19,
  }));
  const calls = installIpc({
    upbringing: () => ({ ...view(), contests }),
    submit: () => ({ outcome: "Done", overview: { ...overview, speed: 0, mode: "upbringing" } }),
  });
  render(<UpbringingScreen />);
  const list = await screen.findByRole("list", { name: "比赛" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(24);
  list.focus();
  expect(list).toHaveFocus();
  await user.tab();
  expect(within(list).getAllByRole("button", { name: "报名" })[0]).toHaveFocus();
  await user.click(within(within(list).getAllByRole("listitem")[23]).getByRole("button", { name: "报名" }));
  expect(calls).toHaveBeenCalledWith("submit", {
    command: { PlayContest: { owner: "player", contest: "contest_23", moves: { register: true } } },
  });
});

describe("养成主画面（新界面）", () => {
  beforeEach(() => setUiFor("v2"));

  it("活动卡上面写着点卡会排进哪一格，排完一格跟着跳；那一格排过了写“换掉……”", async () => {
    const user = userEvent.setup();
    installIpc({ upbringing: () => view() });
    render(<UpbringingScreen />);
    await screen.findByText("家乡 · 土佐中村");
    expect(screen.getByText("点一张卡，排进上旬")).toBeInTheDocument();
    await pickCard(user, "dock");
    expect(screen.getByText("点一张卡，排进中旬")).toBeInTheDocument();
    // 点回已经排了的上旬：写会换掉什么
    await user.click(screen.getByTestId("cell-0:after"));
    expect(screen.getByText("点一张卡，换掉上旬的「码头搬运」")).toBeInTheDocument();
  });

  it("学院期的格子位置带课业 / 课后", async () => {
    installIpc({ upbringing: () => view("academy") });
    render(<UpbringingScreen />);
    await screen.findByText("学院 · 第一年");
    expect(screen.getByText("点一张卡，排进上旬的课业")).toBeInTheDocument();
  });

  it("开始键按不了时就地写原因：先是还有几格没排（补救按钮跳到第一个空格），再是哪一格还要补选（补救按钮把焦点放在没选的下拉框）", async () => {
    const user = userEvent.setup();
    const calls = installIpc({ upbringing: () => view(), submit: () => ({ outcome: "Done", overview: { ...overview, speed: 0, mode: "upbringing" } }) });
    render(<UpbringingScreen />);
    await screen.findByText("家乡 · 土佐中村");
    const go = screen.getByRole("button", { name: "开始这个月" });
    expect(go).toBeDisabled();
    const why = screen.getByTestId("inline-error");
    expect(why).toHaveTextContent("还有 3 格没排");
    // 读屏：开始键指向原因
    expect(go).toHaveAttribute("aria-describedby", why.id);

    // 先去点中旬，再按补救：选中跳回第一个空格（上旬），键盘焦点也在那一格
    await user.click(screen.getByTestId("cell-1:after"));
    expect(screen.getByTestId("cell-1:after")).toHaveAttribute("aria-pressed", "true");
    await user.click(within(why).getByRole("button", { name: "去排上旬" }));
    expect(screen.getByTestId("cell-0:after")).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(screen.getByTestId("cell-0:after")).toHaveFocus());

    await pickCard(user, "dock");
    await pickCard(user, "rest");
    await pickCard(user, "outing");
    // 原因按格子里下拉框的先后写（去哪里在前），不按活动数据里 needs 的先后
    expect(screen.getByTestId("inline-error")).toHaveTextContent("下旬的「约人出去」还要选：去哪里、和谁");
    // 先去点上旬，再按“去选”：回到下旬，焦点落在第一个没选的下拉框（去哪里）
    await user.click(screen.getByTestId("cell-0:after"));
    await user.click(within(screen.getByTestId("inline-error")).getByRole("button", { name: "去选" }));
    expect(screen.getByTestId("cell-2:after")).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(screen.getByLabelText("去哪里")).toHaveFocus());

    await user.selectOptions(screen.getByLabelText("去哪里"), "market");
    expect(screen.getByTestId("inline-error")).toHaveTextContent("还要选：和谁");
    await user.selectOptions(screen.getByLabelText("和谁"), "ushio");
    // 排齐了：原因消失，开始键可以按，按下去照旧提交 PlanMonth
    expect(screen.queryByTestId("inline-error")).not.toBeInTheDocument();
    expect(go).toBeEnabled();
    expect(go).not.toHaveAttribute("aria-describedby");
    await user.click(go);
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: {
          PlanMonth: {
            owner: "player",
            slots: [
              { index: 0, after: { activity: "dock" } },
              { index: 1, after: { activity: "rest" } },
              { index: 2, after: { activity: "outing", companion: "ushio", place: "market" } },
            ],
          },
        },
      }),
    );
  });

  it("本月预计：还没排时写一句说明；排了以后是一枚枚小签（成长、疲劳、心情、零用钱）", async () => {
    const user = userEvent.setup();
    installIpc({ upbringing: () => view() });
    render(<UpbringingScreen />);
    await screen.findByText("家乡 · 土佐中村");
    const proj = screen.getByTestId("ub-projection");
    expect(proj).toHaveTextContent("本月预计");
    expect(proj).toHaveTextContent("排上活动以后，这里会算出这个月大概的收获。");
    await pickCard(user, "dock");
    await pickCard(user, "rest");
    expect(proj).not.toHaveTextContent("排上活动以后");
    const items = [...proj.querySelectorAll(".ub-proj-item")].map((x) => x.textContent);
    // 码头搬运：航海中点 8、疲劳 +10、零用钱中点 30；休息：疲劳 −20、心情 +4
    expect(items).toEqual(["航海 +8", "疲劳 -10", "心情 +4", "零用钱 +30"]);
  });

  it("排得太累时，预计里写一句短的提醒（与小签排在一起，不藏）", async () => {
    const user = userEvent.setup();
    const v = view();
    v.meters.fatigue = { value: 75, max: 100, label: "有点累" };
    installIpc({ upbringing: () => v });
    render(<UpbringingScreen />);
    await screen.findByText("家乡 · 土佐中村");
    const proj = screen.getByTestId("ub-projection");
    expect(proj.querySelector(".ub-warn")).toBeNull();
    // 75 + 码头搬运的疲劳 10 = 85，过了上限的八成
    await pickCard(user, "dock");
    expect(proj.querySelector(".ub-warn")).toHaveTextContent("太累了，可能生病或闹脾气");
    expect(proj).not.toHaveTextContent("这样排会太累");
  });

  it("从课后格换到课业格：选着的分类在课业里没有时当“全部”，列表不空", async () => {
    const user = userEvent.setup();
    installIpc({ upbringing: () => view("academy") });
    render(<UpbringingScreen />);
    await screen.findByText("学院 · 第一年");
    await user.click(screen.getByTestId("cell-0:after"));
    await user.click(screen.getByRole("tab", { name: "打工" }));
    expect(screen.queryByTestId("act-rest")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("cell-1:lesson"));
    expect(screen.getByTestId("act-latin")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "全部" })).toHaveAttribute("aria-selected", "true");
  });

  it("右栏空着的分页用共用的空状态；志向分页里没有志向可选、没有考试时各写一句", async () => {
    const user = userEvent.setup();
    installIpc({ upbringing: () => view() });
    render(<UpbringingScreen />);
    await screen.findByText("家乡 · 土佐中村");
    await user.click(screen.getByRole("tab", { name: "相册" }));
    expect(screen.getByTestId("empty-state")).toHaveTextContent("还没有回忆。关键的那些日子会留在这里。");
    await user.click(screen.getByRole("tab", { name: "书信" }));
    expect(screen.getByTestId("empty-state")).toHaveTextContent("还没有信。");
    await user.click(screen.getByRole("tab", { name: "志向" }));
    const empties = screen.getAllByTestId("empty-state").map((x) => x.textContent);
    expect(empties).toEqual(["现在还不用定志向。", "眼下没有要考的试。"]);
  });
});

describe("养成主画面（旧界面不变）", () => {
  beforeEach(() => setUiFor("v1"));

  it("没有“排进哪一格”、就地原因与预计小签；空分页照旧是一行 .ub-empty；没有 v2 的类", async () => {
    const user = userEvent.setup();
    installIpc({ upbringing: () => view() });
    const { container } = render(<UpbringingScreen />);
    await screen.findByText("家乡 · 土佐中村");
    expect(container.querySelector(".ub-target")).toBeNull();
    expect(screen.queryByTestId("inline-error")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始这个月" })).not.toHaveAttribute("aria-describedby");
    await pickCard(user, "dock");
    const proj = screen.getByTestId("ub-projection");
    expect(proj.querySelector(".ub-proj-item, .ub-proj-label")).toBeNull();
    expect(proj).toHaveTextContent("航海 +8");
    await user.click(screen.getByRole("tab", { name: "相册" }));
    expect(container.querySelector("p.ub-empty")).toHaveTextContent("还没有回忆。");
    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "志向" }));
    expect(screen.queryByText("现在还不用定志向。")).not.toBeInTheDocument();
    expect(v2Classes()).toEqual([]);
  });
});
