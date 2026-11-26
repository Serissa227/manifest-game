// 剧情事件：开局界面的“推荐选择”（带主角与故事线的剧本排在最前面、加亮、缺省选中；选中后只剩剧本与启航两步，开局提交定好的主角）、
// 剧情对话框（说话人、章节、叙事里的主角名、选项的花费与检定、不能选的选项、提交 StoryAnswer、“稍后再说”与顶栏的“故事”，
// 手机上“故事”收在菜单里）、
// 回应之后的结果（效果的写法、故事告一段落）、推荐角色的专属头像、开局向导不列出只给推荐角色的身世选项。
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captainAssetId, portraitSrc, storyPortrait } from "../art/portraitCast";
import { STORY_PORTRAITS } from "../art/portraitAssets";
import StartScreen from "../components/StartScreen";
import StoryDialog from "../components/story/StoryDialog";
import TopBar from "../components/TopBar";
import { StoryButton } from "../components/story/StoryPanel";
import { outcomeText, signed, useStoryUi } from "../components/story/storyKit";
import { heroCreation, rollAnswer, wizardOptions, wizardSteps } from "../components/start/wizard";
import { setLocale } from "../i18n/locale";
import type { CaptainDefsView, Command, Overview, ScenarioView, StaticView, StoryView } from "../ipc/types";
import { useGame } from "../store/game";
import { captainDefs, captainStatics, installIpc, overview } from "./fixtures";
import { PHONE, mockViewport, resetViewport } from "./viewport";

/** 身世数据：第一道问题多一个只给推荐角色 rossella 用的选项。 */
const defs: CaptainDefsView = {
  ...captainDefs,
  questions: captainDefs.questions.map((q, qi) =>
    qi === 0
      ? { ...q, options: [...q.options, { key: "salt_pans", name: "蒙特萨尔的盐田人家", text: "你家晒了四代盐。", attrs: [["commerce", 1], ["stewardship", 1]], effect: null, hero: "rossella" }] }
      : q,
  ),
};

const heroScenario: ScenarioView = {
  key: "rossella",
  name: "盐与潮",
  description: "盐田人家的长女被推上了船。",
  start: 1,
  cash: 6000,
  ships: [0],
  crew: 12,
  mates: 0,
  goal: { kind: "story", target: 7, years: null },
  recommended: true,
  hero: {
    name: "罗塞拉·萨利纳",
    look: 101,
    tagline: "胆小爱哭的盐场长女，背着全家的债出海",
    bio: "蒙特萨尔盐田人家的长女，二十岁。",
    month: 3,
    day: 3,
    age: 20,
    answers: ["salt_pans", "naval_cadet", "family_debt"],
    alloc: [1, 2, 1, 1, 0, 0],
    genius: null,
  },
  story: { key: "rossella", name: "盐与潮", chapters: 7 },
};

const heroStatics: StaticView = { ...captainStatics, captain: defs, scenarios: [...captainStatics.scenarios, heroScenario] };

function storyOverview(story: StoryView): Overview {
  return { ...overview, captain: { name: "罗塞拉", portrait: 101 }, story };
}

const pending: StoryView = {
  line: { key: "rossella", name: "盐与潮", done: 1, total: 7, hint: "在海上跑一阵买卖。" },
  pending: {
    day: 30,
    fleet: 0,
    kind: "chapter",
    key: "first_bill",
    chapter: 2,
    total: 7,
    story: "盐与潮",
    title: "红蜡封的信",
    text: "信差找到{captain}，递来一封盖着红蜡的信。",
    speaker: { kind: "portrait", asset: "keeper-mediterranean-bank-a", name: "佩德雷拉老爷" },
    choices: [
      { text: "马上付清利息。", cost: 2000, blocked: "cash" },
      { text: "写信求他再宽限些日子。", cost: 0, check: { attr: "eloquence", name: "口才", pct: 38 } },
    ],
  },
  last: null,
  journal: [{ day: 0, kind: "chapter", title: "出港的那天早上", choice: "攥紧盐晶，答应一定平安回来。", success: null }],
};

beforeEach(() => setLocale("zh-CN"));
afterEach(() => {
  setLocale("zh-CN");
  useStoryUi.setState({ dismissed: "", panel: false });
});

describe("推荐角色的专属头像", () => {
  it("外貌编号 100 以上是推荐角色的专属头像（384×384 胸像与脸部特写），普通外貌与越界编号照旧", () => {
    // 经典世界的两位推荐角色在最前，编号不变
    expect(STORY_PORTRAITS.slice(0, 2).map((p) => [p.id, p.look])).toEqual([
      ["story-noel", 100],
      ["story-rossella", 101],
    ]);
    // 第九批：寰宇九位主角三个年龄段的专属头像（诺埃尔的 16 岁沿用 story-noel），编号从 110 起、互不重复，图在 story/t16/ 下
    const t16 = STORY_PORTRAITS.filter((p) => p.id.startsWith("t16-") && !p.file.startsWith("portraits/story/t16/npc/"));
    expect(t16).toHaveLength(26);
    expect(new Set(STORY_PORTRAITS.map((p) => p.look)).size).toBe(STORY_PORTRAITS.length);
    // 寰宇的配角（同学 14 岁 / 成年，成年配角一张）：图在 story/t16/npc/ 下，编号同样 ≥ 110、不与别人重复
    const npc = STORY_PORTRAITS.filter((p) => p.file.startsWith("portraits/story/t16/npc/"));
    expect(STORY_PORTRAITS).toHaveLength(28 + npc.length);
    for (const p of npc) {
      expect(p.id).toBe(`t16-${p.file.replace("portraits/story/t16/npc/", "").replace(".webp", "")}`);
      expect(p.look).toBeGreaterThanOrEqual(110);
      expect(p.face).toBe(p.file.replace(".webp", "-face.webp"));
    }
    for (const p of t16) {
      expect(p.look).toBeGreaterThanOrEqual(110);
      expect(p.file).toMatch(/^portraits\/story\/t16\/[a-z]+-(12|14|16)\.webp$/);
      expect(p.meta.age === 12 || p.meta.age === 14 || p.meta.age === 16).toBe(true);
    }
    expect(t16.find((p) => p.id === "t16-lin_wandeng-16")?.file).toBe("portraits/story/t16/lin-16.webp");
    expect(captainAssetId(101)).toBe("story-rossella");
    expect(captainAssetId(100)).toBe("story-noel");
    expect(storyPortrait(101)?.meta.gender).toBe("female");
    expect(storyPortrait(100)?.meta).toMatchObject({ gender: "male", androgynous: true });
    expect(portraitSrc("story-rossella")).toBe("/portraits/story/rossella.webp");
    expect(portraitSrc("story-rossella", "face")).toBe("/portraits/story/rossella-face.webp");
    // 普通外貌与越界编号不变
    expect(captainAssetId(23)).toBe("captain-23");
    expect(captainAssetId(26)).toBe("captain-01");
    expect(storyPortrait(3)).toBeUndefined();
  });
});

describe("开局向导：只给推荐角色的身世选项", () => {
  it("向导里不列出，随机也不会抽到；推荐角色的剧本只剩剧本与启航两步，定好的身世就是提交的 CreateCaptain", () => {
    expect(wizardOptions(defs, 0).map((o) => o.key)).toEqual(["merchant_house", "lighthouse_scribes"]);
    for (let roll = 0; roll < 40; roll++) expect(rollAnswer(defs, 0, null, roll)).not.toBe("salt_pans");
    expect(wizardSteps(defs, true)).toEqual(["scenario", "confirm"]);
    expect(wizardSteps(defs)).toHaveLength(7);
    expect(heroCreation(defs, heroScenario.hero!, 1502)).toEqual({
      birthday: { year: 1482, month: 3, day: 3 },
      answers: ["salt_pans", "naval_cadet", "family_debt"],
      alloc: [1, 2, 1, 1, 0, 0],
      genius: null,
    });
  });
});

describe("开局界面：推荐选择", () => {
  it("推荐角色排在最前面、加亮并缺省选中；下一步直接是启航，开局提交定好的主角与身世", async () => {
    const user = userEvent.setup();
    const calls = installIpc({ static_data: () => heroStatics });
    useGame.setState({ statics: heroStatics, overview: null });
    render(<StartScreen roll={3} />);
    const group = screen.getByTestId("scenario-recommended");
    expect(within(group).getByText("推荐选择")).toBeInTheDocument();
    const card = screen.getByTestId("hero-card-rossella");
    expect(within(card).getByText("推荐")).toBeInTheDocument();
    expect(within(card).getByText("罗塞拉·萨利纳")).toBeInTheDocument();
    expect(within(card).getByText("故事线「盐与潮」· 7 章")).toBeInTheDocument();
    expect(within(card).getByRole("radio")).toBeChecked();
    expect(within(screen.getByTestId("scenario-free")).getByText("新晋船主")).toBeInTheDocument();
    // 两步：剧本 → 启航
    expect(within(screen.getByRole("navigation", { name: "开局步骤" })).getAllByRole("button")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "下一步" }));
    const summary = screen.getByTestId("hero-summary");
    expect(within(summary).getByText("蒙特萨尔盐田人家的长女，二十岁。")).toBeInTheDocument();
    expect(within(summary).getByText(/蒙特萨尔的盐田人家/)).toBeInTheDocument();
    // 启航页的“故事线”一行只写名字与章数（标签已经写了“故事线”）
    expect(within(summary).getByText("「盐与潮」· 7 章")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "开始新游戏" }));
    const names = calls.mock.calls.map(([c]) => c);
    expect(names).toContain("new_game");
    const ng = calls.mock.calls.find(([c]) => c === "new_game")?.[1];
    expect(ng?.scenario).toBe("rossella");
    const sc = calls.mock.calls.find(([c]) => c === "set_captain")?.[1];
    expect(sc?.captain).toEqual({ name: "罗塞拉·萨利纳", portrait: 101 });
    const create = calls.mock.calls
      .filter(([c]) => c === "submit")
      .map(([, a]) => a.command as Command)
      .find((c) => "CreateCaptain" in c);
    expect(create).toEqual({
      CreateCaptain: { owner: "player", birthday: { year: 1482, month: 3, day: 3 }, answers: ["salt_pans", "naval_cadet", "family_debt"], alloc: [1, 2, 1, 1, 0, 0], genius: null },
    });
  });

  it("点“自由开局”里的剧本：照常走完整的向导，只给推荐角色的选项不出现", async () => {
    const user = userEvent.setup();
    installIpc({ static_data: () => heroStatics });
    useGame.setState({ statics: heroStatics, overview: null });
    render(<StartScreen roll={3} />);
    await user.click(within(screen.getByTestId("scenario-free")).getByRole("radio"));
    expect(within(screen.getByRole("navigation", { name: "开局步骤" })).getAllByRole("button")).toHaveLength(7);
    for (let i = 0; i < 12 && !screen.queryByText("你出生在什么样的人家？"); i++) await user.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.queryByRole("radio", { name: /蒙特萨尔的盐田人家/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /港口商人之家/ })).toBeInTheDocument();
  });
});

describe("剧情对话框", () => {
  it("章节：说话人、第几章、叙事里的主角名、选项的花费与检定；付不起的不能选，点另一个提交 StoryAnswer", async () => {
    const user = userEvent.setup();
    const calls = installIpc();
    useGame.setState({ statics: heroStatics, overview: storyOverview(pending) });
    render(<StoryDialog />);
    const dlg = screen.getByTestId("story-dialog");
    expect(within(dlg).getByRole("heading", { name: "红蜡封的信" })).toBeInTheDocument();
    expect(within(dlg).getByText("第 2 章 · 共 7 章")).toBeInTheDocument();
    expect(within(dlg).getByText("盐与潮")).toBeInTheDocument();
    expect(within(dlg).getByTestId("story-text").textContent).toBe("信差找到罗塞拉，递来一封盖着红蜡的信。");
    expect(within(dlg).getByTestId("story-speaker").getAttribute("data-asset")).toBe("keeper-mediterranean-bank-a");
    expect(within(dlg).getByText("佩德雷拉老爷")).toBeInTheDocument();
    const pay = screen.getByTestId("story-choice-0");
    expect(pay).toBeDisabled();
    expect(within(pay).getByText("现金不够")).toBeInTheDocument();
    const plead = screen.getByTestId("story-choice-1");
    expect(within(plead).getByText("口才检定 · 成功率约 38%")).toBeInTheDocument();
    await user.click(plead);
    const sent = calls.mock.calls.filter(([c]) => c === "submit").map(([, a]) => a.command);
    expect(sent).toEqual([{ StoryAnswer: { owner: "player", choice: 1 } }]);
  });

  it("稍后再说：合上对话框；顶栏的“故事”带小红点，面板里写着进度、下一章提示与经历，点“继续这一章”再打开", async () => {
    const user = userEvent.setup();
    installIpc();
    const o = storyOverview(pending);
    useGame.setState({ statics: heroStatics, overview: o });
    render(
      <>
        <StoryButton o={o} />
        <StoryDialog />
      </>,
    );
    expect(screen.getByText("这一章会一直等你；随时可以点顶栏的“故事”继续。")).toBeInTheDocument();
    await user.click(screen.getByTestId("story-later"));
    expect(screen.queryByTestId("story-dialog")).toBeNull();
    const btn = screen.getByTestId("story-button");
    expect(btn.className).toContain("has-alert");
    expect(btn.textContent).toContain("故事 1/7");
    await user.click(btn);
    const panel = screen.getByTestId("story-panel");
    expect(within(panel).getByText("盐与潮 · 第 1/7 章")).toBeInTheDocument();
    expect(within(panel).getByTestId("story-hint").textContent).toContain("在海上跑一阵买卖。");
    expect(within(panel).getByText("出港的那天早上")).toBeInTheDocument();
    await user.click(within(panel).getByTestId("story-reopen"));
    expect(screen.getByTestId("story-dialog")).toBeInTheDocument();
  });

  it("回应之后弹出结果：所选的选项、回应、检定成败与效果；走完最后一章写明故事告一段落；作罢的奇遇不弹结果", async () => {
    installIpc();
    const before = storyOverview({ ...pending, pending: null });
    useGame.setState({ statics: heroStatics, overview: before });
    render(<StoryDialog />);
    expect(screen.queryByTestId("story-result")).toBeNull();
    const after = storyOverview({
      ...pending,
      pending: null,
      last: {
        day: 31,
        kind: "chapter",
        key: "salt_and_tide",
        title: "盐与潮",
        choice: "“我还会出海的。”",
        reply: "罗塞拉·萨利纳的故事到这里告一段落。",
        success: true,
        outcomes: [
          { kind: "fame", value: 10 },
          { kind: "cash", value: -2000 },
          { kind: "goods", value: 3, good: 1 },
          { kind: "mate", value: 0, mate: "luo_changfeng", mate_name: "骆长风" },
        ],
        speaker: { kind: "captain", name: "" },
        ended: true,
      },
    });
    act(() => useGame.setState({ overview: after }));
    const res = screen.getByTestId("story-result");
    expect(within(res).getByText("你选择了：“我还会出海的。”")).toBeInTheDocument();
    expect(within(res).getByTestId("story-check").textContent).toBe("检定成功");
    const outs = within(res).getByTestId("story-outcomes").textContent ?? "";
    expect(outs).toContain("名声 +10");
    expect(outs).toContain("丝绸 +3");
    expect(outs).toContain("骆长风加入了船队");
    expect(within(res).getByTestId("story-ended")).toBeInTheDocument();
    await userEvent.setup().click(within(res).getByRole("button", { name: "继续" }));
    expect(screen.queryByTestId("story-result")).toBeNull();
    // 奇遇当天没有回应就作罢：不弹结果
    act(() =>
      useGame.setState({
        overview: storyOverview({
          ...pending,
          pending: null,
          last: { day: 40, kind: "encounter", key: "bottle", title: "漂流瓶", choice: null, reply: "", success: null, outcomes: [], speaker: { kind: "none", name: "" }, ended: false },
        }),
      }),
    );
    expect(screen.queryByTestId("story-result")).toBeNull();
  });

  it("效果的写法：带正负号（真正的减号），英文界面写 “the {势力}”", () => {
    expect(signed(5)).toBe("+5");
    expect(signed(-5)).toBe("−5");
    expect(outcomeText({ kind: "reputation", value: 5, faction: 0 }, heroStatics)).toBe("翠岚声望 +5");
    setLocale("en");
    expect(outcomeText({ kind: "reputation", value: -3, faction: 0 }, heroStatics)).toBe("Reputation with the 翠岚 −3");
    expect(outcomeText({ kind: "supplies", value: 4 }, heroStatics)).toBe("Days of supplies +4");
  });

  it("手机上：提示指向菜单；紧凑顶栏没有单独的“故事”键，菜单键带小红点，菜单里的“故事”一节点“继续这一章”合上菜单、再打开这一章", async () => {
    mockViewport(PHONE);
    try {
      const user = userEvent.setup();
      installIpc();
      useGame.setState({ statics: heroStatics, overview: storyOverview(pending) });
      render(
        <>
          <TopBar />
          <StoryDialog />
        </>,
      );
      expect(screen.getByTestId("hud")).toHaveClass("hud-compact");
      expect(screen.getByText("这一章会一直等你；随时可以打开菜单里的“故事”继续。")).toBeInTheDocument();
      const menu = screen.getByTestId("hud-menu-button");
      expect(menu.className).not.toContain("has-alert");
      await user.click(screen.getByTestId("story-later"));
      expect(screen.queryByTestId("story-dialog")).toBeNull();
      expect(screen.queryByTestId("story-button")).toBeNull();
      expect(menu.className).toContain("has-alert");
      await user.click(menu);
      const panel = within(screen.getByTestId("hud-sheet")).getByTestId("story-panel");
      expect(within(panel).getByText("盐与潮 · 第 1/7 章")).toBeInTheDocument();
      await user.click(within(panel).getByTestId("story-reopen"));
      expect(screen.queryByTestId("hud-sheet")).toBeNull();
      expect(screen.getByTestId("story-dialog")).toBeInTheDocument();
    } finally {
      resetViewport();
    }
  });

  it("有待决海战时先让海战", () => {
    installIpc();
    useGame.setState({
      statics: heroStatics,
      overview: { ...storyOverview(pending), pending_battles: [{ fleet: 0, pirate: 1, strength: 1, x: 0, y: 0 } as never] },
    });
    render(<StoryDialog />);
    expect(screen.queryByTestId("story-dialog")).toBeNull();
  });
});
