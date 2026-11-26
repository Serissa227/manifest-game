// 第九批 I5：故事 2.0 的剧情对话框——不能选的原因（经典故事的代码照旧按界面字符串写，故事 2.0 与怪异写好的一句话照写）、
// 选项上的门槛小签、检定的名字、后果提示；标题上方的种类、轨道名、地点与“之后还有 N 件”；夜里的事件压暗；
// 十种事件的标签（认不出的按“奇遇”）；故事 2.0 的效果的写法（剧情旗标不给玩家看、认不出的种类不露键名）。
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import StoryDialog from "../components/story/StoryDialog";
import {
  blockedText,
  kindLabel,
  outcomeText,
  outcomeTone,
  shownOutcomes,
  useStoryUi,
} from "../components/story/storyKit";
import { setLocale } from "../i18n/locale";
import type {
  Overview,
  StoryEventView,
  StoryKind,
  StoryOutcomeView,
  StoryResultView,
  StoryView,
} from "../ipc/types";
import { useGame } from "../store/game";
import { captainStatics, installIpc, overview } from "./fixtures";

/** 一件羁绊轨道的事件（照 story2_view.rs 的 JSON 形状）：夜里、带情绪与插画、地点、队列里还有两件。 */
const bond: StoryEventView = {
  day: 120,
  fleet: 0,
  kind: "bond",
  key: "bond_ushio:c2",
  story: "汐 · 羁绊",
  title: "退潮的礁石",
  text: "汐蹲在礁石上，回头叫{captain}过去看。",
  speaker: {
    kind: "portrait",
    person: "ushio",
    asset: "t16-ushio-14",
    portrait: "t16-ushio-14",
    name: "汐",
  },
  choices: [
    {
      key: "follow",
      text: "跟着她下到潮池里。",
      cost: 0,
      check: { attr: "naval", name: "海战", pct: 64 },
      hint: "汐会记得{captain}陪她下过水。",
      requires: ["已完成：退潮的约定", "汐 · 情谊 ≥ 40"],
    },
    {
      key: "wait",
      text: "在岸上等她。",
      cost: 0,
      blocked: "还没有走完“退潮的约定”这一章",
      requires: ["已完成：退潮的约定"],
    },
  ],
  track: "bond_ushio",
  track_name: "汐 · 羁绊",
  mood: "tender",
  art: "tide_pool",
  place: "土佐中村",
  night: true,
  queue: 2,
};

function withStory(story: Partial<StoryView>): Overview {
  return {
    ...overview,
    captain: { name: "澪", portrait: 3 },
    story: { line: null, pending: null, last: null, journal: [], ...story },
  };
}

const submitted = (calls: ReturnType<typeof installIpc>) =>
  calls.mock.calls.filter(([c]) => c === "submit").map(([, a]) => a.command);

beforeEach(() => setLocale("zh-CN"));
afterEach(() => {
  setLocale("zh-CN");
  useStoryUi.setState({ dismissed: "", panel: false, sideCast: null });
});

describe("故事 2.0 的事件", () => {
  it("选项：检定写后端给的名字；门槛是中性的小签；后果提示在选项下面；不能选时照写后端的那句话，不露键名", async () => {
    const user = userEvent.setup();
    const calls = installIpc();
    useGame.setState({
      statics: captainStatics,
      overview: withStory({ pending: bond }),
    });
    render(<StoryDialog />);
    const follow = screen.getByTestId("story-choice-0");
    expect(follow).toBeEnabled();
    // “海战”是评价的名字（属性表里没有），后端给了名字就照写
    expect(
      within(follow).getByText("海战检定 · 成功率约 64%"),
    ).toBeInTheDocument();
    const req = within(follow).getByText("已完成：退潮的约定");
    expect(req).toHaveClass("sd-tag", "is-req");
    expect(req).not.toHaveClass("is-blocked");
    expect(req).toHaveAttribute("title", "门槛");
    expect(within(follow).getByText("汐 · 情谊 ≥ 40")).toHaveClass("is-req");
    const hint = within(follow).getByText("汐会记得澪陪她下过水。");
    expect(hint).toHaveClass("sd-choice-hint");
    const wait = screen.getByTestId("story-choice-1");
    expect(wait).toBeDisabled();
    expect(within(wait).getByText("还没有走完“退潮的约定”这一章")).toHaveClass(
      "sd-tag",
      "is-blocked",
    );
    expect(screen.getByTestId("story-dialog")).not.toHaveTextContent(
      "story.blocked",
    );
    // 焦点在第一个能选的选项上；点它提交 StoryAnswer 第 0 项
    expect(follow).toHaveFocus();
    await user.click(follow);
    expect(submitted(calls)).toEqual([
      { StoryAnswer: { owner: "player", choice: 0 } },
    ]);
  });

  it("标题上方写种类、轨道名、地点与“之后还有 N 件”；夜里的事件压暗；情绪与插画挂在对话框上", () => {
    installIpc();
    useGame.setState({
      statics: captainStatics,
      overview: withStory({ pending: bond }),
    });
    render(<StoryDialog />);
    const kicker = screen.getByTestId("story-kicker");
    expect(within(kicker).getByText("羁绊")).toHaveClass("sd-kind");
    expect(within(kicker).getByText("汐 · 羁绊")).toHaveClass("sd-story-name");
    expect(within(kicker).getByText("土佐中村")).toHaveClass("sd-place");
    expect(within(kicker).getByTestId("story-queue")).toHaveTextContent(
      "之后还有 2 件",
    );
    expect(within(kicker).getByTestId("story-queue")).toHaveAttribute(
      "title",
      "这一件之后还有 2 件事等你回应",
    );
    expect(kicker).not.toHaveTextContent("奇遇");
    const backdrop = screen.getByTestId("story-dialog");
    expect(backdrop).toHaveClass("sd-backdrop", "is-night");
    expect(backdrop).toHaveAttribute("data-night");
    expect(backdrop).toHaveAttribute("data-mood", "tender");
    expect(backdrop).toHaveAttribute("data-art", "tide_pool");
    expect(screen.getByRole("dialog")).toHaveClass("sd-modal", "is-night");
  });

  it("白天、队列空着时：不压暗、不写“之后还有”；故事 2.0 的主线（没有第几章）写“主线”与轨道名", () => {
    installIpc();
    const main: StoryEventView = {
      ...bond,
      kind: "chapter",
      key: "mio_main:c1",
      story: "一条澪 · 主线",
      track_name: "一条澪 · 主线",
      night: false,
      queue: 0,
      place: undefined,
      art: undefined,
    };
    useGame.setState({
      statics: captainStatics,
      overview: withStory({ pending: main }),
    });
    render(<StoryDialog />);
    const kicker = screen.getByTestId("story-kicker");
    expect(kicker).toHaveTextContent("主线");
    expect(kicker).toHaveTextContent("一条澪 · 主线");
    expect(kicker).not.toHaveTextContent("奇遇");
    expect(within(kicker).queryByTestId("story-queue")).toBeNull();
    const backdrop = screen.getByTestId("story-dialog");
    expect(backdrop).not.toHaveClass("is-night");
    expect(backdrop).not.toHaveAttribute("data-night");
    expect(backdrop).not.toHaveAttribute("data-art");
    expect(screen.getByRole("dialog")).not.toHaveClass("is-night");
  });

  it("经典章节照旧写第几章；这时队列里有故事 2.0 的事件也写“之后还有 N 件”", () => {
    installIpc();
    const classic: StoryEventView = {
      day: 30,
      fleet: 0,
      kind: "chapter",
      key: "first_bill",
      chapter: 2,
      total: 7,
      story: "盐与潮",
      title: "红蜡封的信",
      text: "信差递来一封信。",
      speaker: { kind: "none", name: "" },
      choices: [{ text: "拆开。", cost: 0 }],
      queue: 1,
    };
    useGame.setState({
      statics: captainStatics,
      overview: withStory({ pending: classic }),
    });
    render(<StoryDialog />);
    const dlg = screen.getByRole("dialog", { name: "红蜡封的信" });
    expect(dlg).toHaveTextContent("第 2 章 · 共 7 章");
    expect(within(dlg).getByTestId("story-queue")).toHaveTextContent(
      "之后还有 1 件",
    );
    expect(screen.queryByTestId("story-kicker")).toBeNull();
  });

  it("怪异的征兆：种类写“征兆”，夜里的压暗；应对的选项不能选时照写后端的那句话", () => {
    installIpc();
    const omen: StoryEventView = {
      day: 200,
      fleet: 0,
      kind: "omen",
      key: "c-1",
      title: "海面上的火",
      text: "夜里的海面上浮着一串幽火。",
      speaker: { kind: "none", name: "" },
      choices: [
        { key: "observe", text: "远远看着。", cost: 0 },
        {
          key: "offer",
          text: "撒一把米。",
          cost: 50,
          blocked: "现在拿不出这份供品",
        },
      ],
      night: true,
    };
    useGame.setState({
      statics: captainStatics,
      overview: withStory({ pending: omen }),
    });
    render(<StoryDialog />);
    expect(screen.getByTestId("story-kicker")).toHaveTextContent("征兆");
    expect(screen.getByTestId("story-dialog")).toHaveClass("is-night");
    const offer = screen.getByTestId("story-choice-1");
    expect(offer).toBeDisabled();
    expect(within(offer).getByText("现在拿不出这份供品")).toHaveClass(
      "is-blocked",
    );
  });
});

describe("事件种类的标签与不能选的原因", () => {
  it("十种事件各有标签，认不出的按“奇遇”；英文界面照样有", () => {
    const zh: Record<StoryKind, string> = {
      chapter: "主线",
      encounter: "奇遇",
      side: "旁观",
      upbringing: "养成",
      bond: "羁绊",
      history: "时间线",
      request: "请托",
      letter: "来信",
      omen: "征兆",
      contest: "比赛",
    };
    for (const [k, v] of Object.entries(zh)) expect(kindLabel(k)).toBe(v);
    expect(kindLabel("weird")).toBe("奇遇");
    setLocale("en");
    expect(kindLabel("request")).toBe("Request");
    expect(kindLabel("omen")).toBe("Omen");
    expect(kindLabel("weird")).toBe("Encounter");
  });

  it("经典故事的代码按界面字符串写，后端写好的话照写（两种语言）", () => {
    expect(blockedText("cash")).toBe("现金不够");
    expect(blockedText("cargo")).toBe("货舱里的货不够");
    expect(blockedText("还没有走完“退潮的约定”这一章")).toBe(
      "还没有走完“退潮的约定”这一章",
    );
    setLocale("en");
    expect(blockedText("cash")).toBe("Not enough cash");
    expect(blockedText("The tide has not turned yet")).toBe(
      "The tide has not turned yet",
    );
  });
});

describe("故事 2.0 的效果", () => {
  const out = (
    o: Partial<StoryOutcomeView> & Pick<StoryOutcomeView, "kind">,
  ): StoryOutcomeView => ({ value: 0, ...o });

  it("每一种都有写法，不露键名；名字取后端给的（成长值的属性按属性表）", () => {
    const cases: [StoryOutcomeView, string][] = [
      [out({ kind: "growth", attr: "seamanship", value: 30 }), "航海成长 +30"],
      // B12：后端给了当前语言的技能名就写名字；旧后端只给 key 时照旧不写 key
      [
        out({ kind: "skill", skill: "sailing", skill_name: "航海", value: 4 }),
        "航海经验 +4",
      ],
      [
        out({ kind: "skill", skill: "arcana_alchemy", value: 20 }),
        "技能经验 +20",
      ],
      [
        out({ kind: "affinity", person: "ushio", person_name: "汐", value: 3 }),
        "汐情谊 +3",
      ],
      [
        out({ kind: "heart", person: "ushio", person_name: "汐", value: -2 }),
        "汐心动 −2",
      ],
      [
        out({
          kind: "relation",
          person: "ushio",
          person_name: "汐",
          relation: "friends",
          text: "朋友",
          value: 1,
        }),
        "与汐：朋友",
      ],
      [
        out({
          kind: "relation",
          person: "ushio",
          person_name: "汐",
          relation: "rivals",
          text: "对手",
          value: -1,
        }),
        "与汐：不再是对手",
      ],
      [
        out({
          kind: "relation",
          person: "sophie_lemaire",
          person_name: "索菲",
          persons: ["ines_costa", "sophie_lemaire"],
          relation: "lovers",
          text: "伊内丝 / 索菲 · 恋人",
          value: 1,
        }),
        "伊内丝 / 索菲 · 恋人",
      ],
      [
        out({
          kind: "relation",
          person: "sophie_lemaire",
          person_name: "索菲",
          persons: ["ines_costa", "sophie_lemaire"],
          relation: "lovers",
          text: "伊内丝 / 索菲 · 恋人",
          value: -1,
        }),
        "伊内丝 / 索菲 · 恋人（到此为止）",
      ],
      [
        out({
          kind: "item",
          item: "shell_bracelet",
          item_name: "贝壳手环",
          value: 1,
        }),
        "得到 贝壳手环 ×1",
      ],
      [
        out({
          kind: "item",
          item: "shell_bracelet",
          item_name: "贝壳手环",
          value: -2,
        }),
        "交出 贝壳手环 ×2",
      ],
      [
        out({
          kind: "memory",
          memory: "mem-bond_ushio-a",
          title: "退潮的礁石",
        }),
        "留下回忆：退潮的礁石",
      ],
      [out({ kind: "title", title: "潮汐的朋友" }), "得到称号：潮汐的朋友"],
      [
        out({
          kind: "letter",
          person: "abdullah",
          person_name: "阿卜杜拉",
          text: "你今年没来。",
        }),
        "阿卜杜拉的来信：你今年没来。",
      ],
      [
        out({ kind: "mate", mate: "ushio", mate_name: "汐", value: 1 }),
        "汐加入了船队",
      ],
      [
        out({ kind: "mate", mate: "ushio", mate_name: "汐", value: -1 }),
        "汐离开了船队",
      ],
      [out({ kind: "fame", value: 5 }), "名声 +5"],
    ];
    for (const [o, text] of cases) {
      expect(outcomeText(o, captainStatics), o.kind).toBe(text);
      expect(outcomeText(o, captainStatics)).not.toContain("story.");
    }
    setLocale("en");
    expect(
      outcomeText(
        out({ kind: "affinity", person_name: "Ushio", value: 3 }),
        captainStatics,
      ),
    ).toBe("Affinity with Ushio +3");
    expect(
      outcomeText(
        out({
          kind: "skill",
          skill: "sailing",
          skill_name: "Sailing",
          value: 4,
        }),
        captainStatics,
      ),
    ).toBe("Sailing XP +4");
    expect(
      outcomeText(
        out({ kind: "skill", skill: "sailing", value: -1 }),
        captainStatics,
      ),
    ).toBe("Skill XP −1");
    expect(
      outcomeText(
        out({
          kind: "relation",
          person_name: "Ushio",
          text: "Rivals",
          value: -1,
        }),
        captainStatics,
      ),
    ).toBe("With Ushio: no longer Rivals");
    expect(
      outcomeText(
        out({ kind: "item", item_name: "Shell bracelet", value: -1 }),
        captainStatics,
      ),
    ).toBe("Handed over Shell bracelet ×1");
    expect(
      outcomeText(
        out({ kind: "mate", mate_name: "Ushio", value: -1 }),
        captainStatics,
      ),
    ).toBe("Ushio left your fleet");
  });

  it("剧情旗标与认不出的种类不列出来；好坏着色：离队与心动下降为坏，关系与来信不分好坏，回忆与称号为好", () => {
    const flag = out({
      kind: "flag",
      flag: "c7_bond_abdullah_promise",
      value: 1,
    });
    expect(outcomeText(flag, captainStatics)).toBe("");
    const unknown = {
      kind: "otherworld",
      value: 1,
    } as unknown as StoryOutcomeView;
    expect(outcomeText(unknown, captainStatics)).toBe("");
    const memory = out({ kind: "memory", title: "握绳的人" });
    expect(
      shownOutcomes([flag, memory, unknown], captainStatics).map((x) => x.text),
    ).toEqual(["留下回忆：握绳的人"]);
    expect(outcomeTone(out({ kind: "mate", value: -1 }))).toBe("down");
    expect(outcomeTone(out({ kind: "mate", value: 1 }))).toBe("up");
    expect(outcomeTone(out({ kind: "heart", value: -2 }))).toBe("down");
    expect(
      outcomeTone(out({ kind: "relation", relation: "enemies", value: 1 })),
    ).toBe("same");
    expect(outcomeTone(out({ kind: "letter" }))).toBe("same");
    expect(outcomeTone(memory)).toBe("up");
    expect(outcomeTone(out({ kind: "title", title: "x" }))).toBe("up");
  });

  it("结果对话框：只有旗标时写“没有带来什么变化”；来信整行，信里的 {captain} 换成主角名", () => {
    installIpc();
    useGame.setState({ statics: captainStatics, overview: withStory({}) });
    render(<StoryDialog />);
    const result = (
      outcomes: StoryOutcomeView[],
      day: number,
    ): StoryResultView => ({
      day,
      kind: "bond",
      key: "bond_abdullah:s",
      title: "握绳的人",
      choice: "接过绳子。",
      reply: "他把绳头递了过来。",
      success: null,
      outcomes,
      speaker: { kind: "none", name: "" },
      ended: false,
    });
    act(() =>
      useGame.setState({
        overview: withStory({
          last: result(
            [out({ kind: "flag", flag: "c7_bond_abdullah_promise", value: 1 })],
            300,
          ),
        }),
      }),
    );
    let res = screen.getByTestId("story-result");
    expect(within(res).getByTestId("story-outcomes")).toHaveTextContent(
      "没有带来什么变化。",
    );
    expect(within(res).getByTestId("story-outcomes")).not.toHaveTextContent(
      "c7_bond_abdullah_promise",
    );
    act(() =>
      useGame.setState({
        overview: withStory({
          last: result(
            [
              out({ kind: "flag", flag: "c7_bond_abdullah_promise", value: 1 }),
              out({
                kind: "affinity",
                person: "abdullah",
                person_name: "阿卜杜拉",
                value: 5,
              }),
              out({
                kind: "letter",
                person: "abdullah",
                person_name: "阿卜杜拉",
                text: "{captain}：明年你若来，换你。",
              }),
            ],
            301,
          ),
        }),
      }),
    );
    res = screen.getByTestId("story-result");
    const items = within(
      within(res).getByTestId("story-outcomes"),
    ).getAllByRole("listitem");
    expect(items.map((x) => x.textContent)).toEqual([
      "阿卜杜拉情谊 +5",
      "阿卜杜拉的来信：澪：明年你若来，换你。",
    ]);
    expect(items[0]).toHaveClass("is-up");
    expect(items[1]).toHaveAttribute("data-kind", "letter");
    expect(items[1]).toHaveClass("is-same");
  });
});

describe("U02：门槛差一点也能掷骰", () => {
  it("选项写成功率与差多少（成功率读 chance，不读 check.pct）；掷完的结果写骰点与成败", () => {
    installIpc();
    const soft: StoryEventView = {
      ...bond,
      choices: [
        {
          key: "try",
          text: "抓住帆脚索试一试。",
          cost: 0,
          requires: ["技能经验 · 操帆 ≥ 60"],
          chance: 45,
          soft_gap: [{ key: "rigging", label: "操帆", have: 45, need: 60 }],
        },
        {
          key: "follow",
          text: "跟着她下到潮池里。",
          cost: 0,
          check: { attr: "naval", name: "海战", pct: 64 },
          chance: 32,
          soft_gap: [{ key: "naval", label: "海战", have: 240, need: 300 }],
        },
        {
          key: "again",
          text: "再试一次。",
          cost: 0,
          failed: true,
          blocked: "这个选项这次已经试过了，等本事够了再来",
          soft_gap: [{ key: "naval", label: "海战", have: 240, need: 300 }],
        },
      ],
    };
    useGame.setState({
      statics: captainStatics,
      overview: withStory({ pending: soft }),
    });
    const { unmount } = render(<StoryDialog />);
    const tryIt = screen.getByTestId("story-choice-0");
    expect(tryIt).toBeEnabled();
    expect(within(tryIt).getByText("掷骰 · 成功率约 45%")).toHaveClass(
      "sd-tag",
      "is-chance",
    );
    expect(within(tryIt).getByText("操帆 45/60")).toHaveClass(
      "sd-tag",
      "is-gap",
    );
    // 有原检定时合在一个签里，数字是最终成功率
    expect(
      within(screen.getByTestId("story-choice-1")).getByText(
        "海战检定 · 成功率约 32%",
      ),
    ).toBeInTheDocument();
    const again = screen.getByTestId("story-choice-2");
    expect(again).toBeDisabled();
    expect(
      within(again).getByText("这个选项这次已经试过了，等本事够了再来"),
    ).toHaveClass("is-blocked");
    expect(within(again).queryByText(/成功率/)).toBeNull();
    unmount();
    const result: StoryResultView = {
      day: 130,
      kind: "bond",
      key: "bond_ushio:c2",
      title: "退潮的礁石",
      choice: "抓住帆脚索试一试。",
      reply: "绳子从手里滑走了。",
      success: false,
      outcomes: [],
      speaker: { kind: "none", name: "" },
      ended: false,
    };
    useGame.setState({ overview: withStory({}) });
    render(<StoryDialog />);
    act(() =>
      useGame.setState({
        overview: withStory({
          last: result,
          last_roll: { chance: 45, roll: 62, success: false, choice: "try" },
        }),
      }),
    );
    const roll = screen.getByTestId("story-roll");
    expect(roll).toHaveClass("sd-roll", "is-fail");
    expect(roll).toHaveTextContent("掷出 62，45 以内算成功");
    expect(screen.getByTestId("story-check")).toHaveTextContent("失败");
  });

  it("规则关闭（没有 last_roll）时结果里不写骰点", () => {
    installIpc();
    useGame.setState({ statics: captainStatics, overview: withStory({}) });
    render(<StoryDialog />);
    const result: StoryResultView = {
      day: 131,
      kind: "bond",
      key: "bond_ushio:c3",
      title: "退潮的礁石",
      choice: "跟着她下到潮池里。",
      reply: "",
      success: true,
      outcomes: [],
      speaker: { kind: "none", name: "" },
      ended: false,
    };
    act(() => useGame.setState({ overview: withStory({ last: result }) }));
    expect(screen.getByTestId("story-result")).toBeInTheDocument();
    expect(screen.queryByTestId("story-roll")).toBeNull();
  });
});

describe("最后一天的提醒（P11：出海后待答的章节只在出场那天与最后一天叫停时钟）", () => {
  // 出海后的一章（kind: chapter），第 131 天出场
  const chapter: StoryEventView = { ...bond, kind: "chapter", day: 131 };
  const at = (day: number, pending: StoryEventView) => ({ ...withStory({ pending }), day });

  it("平常：脚注写“这一章会一直等你”；最后一天换成“过了今天就不再等你”", () => {
    installIpc();
    useGame.setState({ statics: captainStatics, overview: at(131, chapter) });
    const { unmount } = render(<StoryDialog />);
    expect(screen.queryByTestId("story-last-day")).toBeNull();
    expect(screen.getByText(/这一章会一直等你/)).toBeInTheDocument();
    unmount();
    useGame.setState({ overview: at(140, { ...chapter, last_day: true }) });
    render(<StoryDialog />);
    expect(screen.getByTestId("story-last-day")).toHaveTextContent("今天是最后一天：过了今天，这件事就不再等你了。");
    expect(screen.queryByText(/这一章会一直等你/)).toBeNull();
  });

  it("点过“稍后再说”的章节：之后的日子不再弹；到了最后一天重新交到面前；当天再点“稍后”就不再打扰", async () => {
    const user = userEvent.setup();
    installIpc();
    useGame.setState({ statics: captainStatics, overview: at(131, chapter) });
    render(<StoryDialog />);
    await user.click(screen.getByTestId("story-later"));
    expect(screen.queryByTestId("story-later")).toBeNull();
    // 过了几天，章节还等着：不弹
    act(() => useGame.setState({ overview: at(135, chapter) }));
    expect(screen.queryByTestId("story-later")).toBeNull();
    // 最后一天：重新弹出，并写明
    act(() => useGame.setState({ overview: at(140, { ...chapter, last_day: true }) }));
    expect(await screen.findByTestId("story-last-day")).toBeInTheDocument();
    // 当天再收起：同一天的概览再推过来也不再弹
    await user.click(screen.getByTestId("story-later"));
    act(() => useGame.setState({ overview: { ...at(140, { ...chapter, last_day: true }), cash: 1 } }));
    expect(screen.queryByTestId("story-later")).toBeNull();
  });

  it("出场的当天就是最后一天：点了“稍后再说”不会立刻又弹回来", async () => {
    const user = userEvent.setup();
    installIpc();
    useGame.setState({ statics: captainStatics, overview: at(131, { ...chapter, last_day: true }) });
    render(<StoryDialog />);
    await user.click(screen.getByTestId("story-later"));
    act(() => useGame.setState({ overview: { ...at(131, { ...chapter, last_day: true }), cash: 2 } }));
    expect(screen.queryByTestId("story-later")).toBeNull();
  });
});
