// 比赛对话框的手感：
// 顶上一行写清怎么赢；选了就地写效果、胜算跟着变（后端 contest_preview）；键盘玩到底（数字键、方向键、回车、Esc、退格）；
// 交卷以后讲清楚名次是怎么来的（后端 contest_outcome）；后端没有这两个查询时照旧能玩、交卷照旧关掉（contests.test.tsx）。
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ContestDialog from "../components/contests/ContestDialog";
import { digitKey, nextOpen, rhythmHits, signed } from "../components/contests/contestKit";
import type { ContestOutcome, ContestPreview, ContestView } from "../ipc/types";
import { useGame } from "../store/game";
import { applyUi, useUiVersion } from "../ui/uiMode";
import { installIpc, overview, statics } from "./fixtures";

const base = (kind: ContestView["kind"], params: Record<string, unknown>): ContestView => ({
  key: `c_${kind}`,
  name: "学舍的歌合",
  kind,
  seed: 7,
  params,
  rivals: [
    { key: "kiku", name: "菊千代", portrait: null },
    { key: "yuki", name: "冷泉雪", portrait: null },
  ],
  auto_pct: 42,
});

/** 截图与测试用的假预估：作诗每句各选项的分 */
const POINTS = [
  [3, 5, 4],
  [5, 3, 2],
  [5, 4, 3],
];
function poemPreview(moves: unknown[]): ContestPreview {
  const steps = moves.map((m, i) => (m === null ? null : { got: POINTS[i][m as number], best: Math.max(...POINTS[i]) }));
  const bonus = Math.min(15, steps.reduce((s, x) => s + (x?.got ?? 0), 0));
  return { strength: 60, max_bonus: 15, best_bonus: 15, unit: null, bonus, pct: 42 + bonus * 2, base_pct: 42, best_pct: 72, ready: moves.every((m) => m !== null), steps, options: [] };
}

const poem = base("poem", {
  theme: "待月",
  hints: ["季语：月、虫声", "末句要落在“等”字上"],
  lines: [
    { prompt: "庭前虫声＿", options: ["细", "急", "远"] },
    { prompt: "＿上东山迟", options: ["月", "云", "雁"] },
    { prompt: "倚门犹自＿", options: ["等", "望", "立"] },
  ],
});

const win: ContestOutcome = {
  rank: 1,
  total: 3,
  score: 82,
  game_score: 87,
  jitter: 3,
  bonus: 13,
  strength: 66,
  field: [
    { key: "$captain", name: null, score: 82, you: true },
    { key: "kiku", name: "菊千代", score: 76, you: false },
    { key: "yuki", name: "冷泉雪", score: 61, you: false },
  ],
  steps: [],
};

function setUiFor(ui: "v1" | "v2") {
  applyUi(ui);
  useUiVersion.setState({ ui });
}

beforeEach(() => {
  useGame.setState({ statics, overview, version: 1, error: null, message: null });
});
afterEach(() => {
  cleanup();
  setUiFor("v1");
});

describe("小游戏的纯逻辑（手感）", () => {
  it("节奏的“打准几拍”与内核 contests/rhythm.rs 的配法一致（同一组例子）", () => {
    const beats = [1000, 1500, 2000];
    expect(rhythmHits(beats, 100, [900, 1600, 2000])).toBe(3);
    expect(rhythmHits(beats, 100, [899, 1601])).toBe(0);
    expect(rhythmHits(beats, 100, [900, 1000, 1500, 2000])).toBe(3);
    expect(rhythmHits(beats, 100, [1000])).toBe(1);
    expect(rhythmHits(beats, 100, [])).toBe(0);
    expect(rhythmHits(beats, 100, [1000, 1000])).toBe(1);
    expect(rhythmHits(beats, 100, [2101, 4294967295])).toBe(0);
    expect(rhythmHits([100, 200], 100, [150])).toBe(1);
    expect(rhythmHits([100, 200], 100, [150, 200])).toBe(2);
    expect(rhythmHits([100, 200], 100, [150, 150])).toBe(1);
  });

  it("下一步跳到哪、数字键、有符号的数", () => {
    expect(nextOpen([1, null, null], 0)).toBe(1);
    expect(nextOpen([null, 2, 0], 2)).toBe(0);
    expect(nextOpen([1, 2, 0], 1)).toBe(-1);
    const k = (key: string, mod = false) => ({ key, ctrlKey: mod, altKey: false, metaKey: false });
    expect(digitKey(k("1"))).toBe(0);
    expect(digitKey(k("9"))).toBe(8);
    expect(digitKey(k("0"))).toBeNull();
    expect(digitKey(k("1", true))).toBeNull();
    expect(digitKey(k("a"))).toBeNull();
    expect([signed(3), signed(0), signed(-2)]).toEqual(["+3", "0", "−2"]);
  });
});

describe("比赛对话框：作诗", () => {
  it("顶上写清怎么赢；选一个词就地写这一句加几分，胜算跟着变", async () => {
    const user = userEvent.setup();
    const calls = installIpc({ contest: () => poem, contest_preview: (a) => poemPreview(a.moves as unknown[]) });
    render(<ContestDialog contest="c_poem" onClose={() => {}} />);
    expect(await screen.findByText("每句挑一个词，3 句都选好就吟出；每句按用词给分，合起来加在实力上。最多 +15。")).toBeInTheDocument();
    // 一句没选：胜算就是按实力的 42%
    expect(await screen.findByText("照现在约 42%")).toBeInTheDocument();
    expect(screen.getByText("不玩 42%")).toBeInTheDocument();
    expect(screen.getByText("拿满 72%")).toBeInTheDocument();
    // 第一句选“细”：这句 3 分（最多 5），胜算 48%
    await user.click(within(screen.getByRole("radiogroup", { name: "第 1 句" })).getByRole("radio", { name: "细" }));
    expect(await screen.findByText("+3，最多能拿 +5")).toBeInTheDocument();
    expect(await screen.findByText("照现在约 48%")).toBeInTheDocument();
    expect(screen.getByText("小游戏 +3 / 15")).toBeInTheDocument();
    // 改成“急”：这句拿满，胜算升到 52%
    await user.click(within(screen.getByRole("radiogroup", { name: "第 1 句" })).getByRole("radio", { name: "急" }));
    expect(await screen.findByText("+5，拿满了")).toBeInTheDocument();
    expect(await screen.findByText("照现在约 52%")).toBeInTheDocument();
    expect(screen.queryByText("+3，最多能拿 +5")).toBeNull();
    // 每次都按当时的输入问后端（没选的一句是 null）
    expect(calls).toHaveBeenCalledWith("contest_preview", { key: "c_poem", moves: [null, null, null] });
    expect(calls).toHaveBeenCalledWith("contest_preview", { key: "c_poem", moves: [1, null, null] });
  });

  it("键盘玩到底：数字键选词并跳到下一句，选完焦点到“吟出”，回车交卷", async () => {
    const user = userEvent.setup();
    const calls = installIpc({ contest: () => poem, contest_preview: (a) => poemPreview(a.moves as unknown[]) });
    render(<ContestDialog contest="c_poem" onClose={() => {}} />);
    const first = await screen.findByRole("radio", { name: "细" });
    // 一打开焦点就在第一句的第一个词上
    await waitFor(() => expect(first).toHaveFocus());
    await user.keyboard("2");
    expect(within(screen.getByRole("radiogroup", { name: "第 1 句" })).getByRole("radio", { name: "急" })).toHaveAttribute("aria-checked", "true");
    // 焦点自动到第二句
    expect(within(screen.getByRole("radiogroup", { name: "第 2 句" })).getByRole("radio", { name: "月" })).toHaveFocus();
    await user.keyboard("1");
    await user.keyboard("1");
    expect(screen.getByRole("button", { name: "吟出" })).toHaveFocus();
    expect(screen.getByText("庭前虫声急 / 月上东山迟 / 倚门犹自等")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { PlayContest: { owner: "player", contest: "c_poem", moves: [1, 0, 0] } } }));
  });

  it("↑↓ 换一句、←→ 在一句里挪（不跳句）；焦点在选项上时回车也交卷", async () => {
    const user = userEvent.setup();
    const calls = installIpc({ contest: () => poem });
    render(<ContestDialog contest="c_poem" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole("radio", { name: "细" })).toHaveFocus());
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: "月" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "月" })).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "云" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "云" })).toHaveFocus();
    await user.keyboard("{ArrowUp}3");
    expect(screen.getByRole("radio", { name: "远" })).toHaveAttribute("aria-checked", "true");
    // 第一句选好后跳到还没选的第三句
    expect(screen.getByRole("radio", { name: "等" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { PlayContest: { owner: "player", contest: "c_poem", moves: [2, 1, 0] } } }));
  });

  it("Esc 是按实力结算：只关掉、不提交；快捷键写在底栏（新界面）", async () => {
    const user = userEvent.setup();
    setUiFor("v2");
    const calls = installIpc({ contest: () => poem });
    let closed = false;
    render(<ContestDialog contest="c_poem" onClose={() => (closed = true)} />);
    await waitFor(() => expect(screen.getByRole("radio", { name: "细" })).toHaveFocus());
    const keys = screen.getByRole("list", { name: "快捷键" });
    expect(within(keys).getByText("换一句")).toBeInTheDocument();
    expect(within(keys).getByText("按实力结算")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(closed).toBe(true);
    expect(calls.mock.calls.some((c) => c[0] === "submit")).toBe(false);
  });

  it("交卷以后讲清楚：名次、各人的分、你的分怎么来的、赢在哪里；“好”关掉", async () => {
    const user = userEvent.setup();
    installIpc({ contest: () => poem, contest_preview: (a) => poemPreview(a.moves as unknown[]), contest_outcome: () => win });
    let closed = false;
    render(<ContestDialog contest="c_poem" onClose={() => (closed = true)} />);
    await waitFor(() => expect(screen.getByRole("radio", { name: "细" })).toHaveFocus());
    await user.keyboard("211{Enter}");
    const result = await screen.findByRole("status", { name: "比赛结果" });
    expect(within(result).getByText("第一名！")).toBeInTheDocument();
    expect(within(result).getByText("第 1 名（共 3 人）")).toBeInTheDocument();
    expect(within(result).getByText("小游戏的 +13 是赢的关键：不算它，你会输给菊千代（76 分）。")).toBeInTheDocument();
    expect(within(result).getByText("你的 82 分 = 实力 66 + 小游戏 +13 + 临场 +3")).toBeInTheDocument();
    const rows = within(result).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(["1你82 分", "2菊千代76 分", "3冷泉雪61 分"]);
    expect(rows[0]).toHaveClass("is-you");
    // 交过卷就不能再改；“按实力结算”也不在了
    expect(screen.getByRole("radio", { name: "细" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "按实力结算" })).toBeNull();
    expect(closed).toBe(false);
    expect(within(result).getByRole("button", { name: "好" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(closed).toBe(true);
  });

  it("输了：差得不多时说小游戏再多拿几分就够；差得多时说对手发挥得好", async () => {
    const user = userEvent.setup();
    const lose = (them: number): ContestOutcome => ({
      ...win,
      rank: 2,
      score: 70,
      bonus: 8,
      strength: 60,
      jitter: 2,
      field: [
        { key: "kiku", name: "菊千代", score: them, you: false },
        { key: "$captain", name: null, score: 70, you: true },
        { key: "yuki", name: "冷泉雪", score: 61, you: false },
      ],
    });
    for (const [them, text] of [
      [74, "只差菊千代 4 分；小游戏再多拿 5 分就够了。"],
      [90, "菊千代今天发挥得好（90 分），比你高 20 分。多练习、带上帮手，实力上去了才稳。"],
    ] as const) {
      installIpc({ contest: () => poem, contest_preview: (a) => poemPreview(a.moves as unknown[]), contest_outcome: () => lose(them) });
      const { unmount } = render(<ContestDialog contest="c_poem" onClose={() => {}} />);
      await waitFor(() => expect(screen.getByRole("radio", { name: "细" })).toHaveFocus());
      await user.keyboard("111{Enter}");
      const result = await screen.findByRole("status", { name: "比赛结果" });
      expect(within(result).getByText("第 2 名（共 3 人）")).toBeInTheDocument();
      expect(within(result).queryByText("第一名！")).toBeNull();
      expect(within(result).getByText(text)).toBeInTheDocument();
      unmount();
    }
  });
});

describe("比赛对话框：辩论、竞渡、辨识、配对", () => {
  const debate = base("debate", {
    topic: "货船过了归期，该记亏还是再等",
    rounds: [
      { opponent: { text: "过了季风还不回，照亏记吧", kind: "reason" } },
      { opponent: { text: "去年那条也晚了，结果没了", kind: "counterexample" } },
    ],
    hand: [
      { key: "c_obs", text: "同帮船主在吕宋还见过它", kind: "observation" },
      { key: "c_ce", text: "晚了半年也回来了的船", kind: "counterexample" },
      { key: "c_rea", text: "去暹罗与去吕宋季风不同", kind: "reason" },
    ],
    beats: [
      ["observation", "reason"],
      ["counterexample", "observation"],
      ["reason", "counterexample"],
    ],
  });

  it("辩论：论点的种类写中文、写出克制关系；手牌标出对上这一回合是压过还是被压过；数字键出牌、退格撤回、回车交卷", async () => {
    const user = userEvent.setup();
    const calls = installIpc({
      contest: () => debate,
      contest_preview: (a) => {
        const m = a.moves as (string | null)[];
        const steps = m.map((k, i) => (k === null ? null : { got: (i === 0 && k === "c_obs") || (i === 1 && k === "c_rea") ? 5 : 0, best: 5, edge: 1 as const }));
        return { strength: 60, max_bonus: 15, best_bonus: 10, unit: 5, bonus: 0, pct: 42, base_pct: 42, best_pct: 60, ready: false, steps, options: [] };
      },
    });
    render(<ContestDialog contest="c_debate" onClose={() => {}} />);
    expect(await screen.findByText("实证压过推理 · 反例压过实证 · 推理压过反例")).toBeInTheDocument();
    expect(await screen.findByText("每回合出一张论点，每张只能用一次。压过对方那一类 +5，平手、被压过不加分。最多 +10。")).toBeInTheDocument();
    const hand = screen.getByRole("list", { name: "你的论点" });
    expect(within(hand).getByRole("button", { name: /同帮船主在吕宋还见过它\s*压过 \+5/ })).toBeInTheDocument();
    expect(within(hand).getByRole("button", { name: /去暹罗与去吕宋季风不同\s*平手/ })).toBeInTheDocument();
    expect(screen.queryByText("observation")).toBeNull();
    await waitFor(() => expect(within(hand).getAllByRole("button")[0]).toHaveFocus());
    await user.keyboard("2");
    // 反例对推理：被推理压过
    expect(document.querySelector(".ct-edge-1")).not.toBeNull();
    await user.keyboard("{Backspace}");
    expect(document.querySelector(".ct-edge-1")).toBeNull();
    await user.keyboard("1");
    expect(document.querySelector(".ct-edge1")).not.toBeNull();
    expect(await within(document.querySelector<HTMLElement>(".ct-mine")!).findByText("压过 +5")).toBeInTheDocument();
    // 第二回合：剩下的牌里“推理”压过“反例”，排第二
    await user.keyboard("2");
    expect(screen.getByRole("button", { name: "交卷" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { PlayContest: { owner: "player", contest: "c_debate", moves: ["c_obs", "c_rea"] } } }));
  });

  const race = base("race", {
    legs: [
      { text: "出港，顺风", options: [{ key: "shore", text: "贴岸", risk: 0 }, { key: "wind", text: "抢风", risk: 2000 }] },
      { text: "冲线", options: [{ key: "row", text: "全员划桨", risk: 0 }, { key: "sail", text: "满帆", risk: 1500 }] },
    ],
  });
  const racePreview = (moves: unknown[]): ContestPreview => {
    const now = moves.findIndex((m) => m === null);
    const legs = race.params.legs as { options: { key: string; risk: number }[] }[];
    const steps = moves.map((m) => (m === null ? null : m === "wind" ? { got: 4, best: 5, win: 5, lose: 1, risk: 2000 } : { got: 3, best: 5, win: 3, lose: 1, risk: 0 }));
    const options = now < 0 ? [] : legs[now].options.map((o) => ({ key: o.key, win: o.risk ? 5 : 3, lose: 1, risk: o.risk }));
    return { strength: 60, max_bonus: 15, best_bonus: 10, unit: null, bonus: 4, pct: 50, base_pct: 42, best_pct: 60, ready: now < 0, steps, options };
  };

  it("竞渡：每种走法写出顺利 / 失手各加几分；选好的一程写预计；交卷后写出哪一程失手了", async () => {
    const user = userEvent.setup();
    const calls = installIpc({
      contest: () => race,
      contest_preview: (a) => racePreview(a.moves as unknown[]),
      contest_outcome: () => ({ ...win, rank: 2, field: [win.field[1], win.field[0], win.field[2]], steps: [{ failed: true, course: 100 }, { failed: false, course: 100 }] }),
    });
    render(<ContestDialog contest="c_race" onClose={() => {}} />);
    expect(await screen.findByText("顺利 +5 · 失手 +1")).toBeInTheDocument();
    expect(screen.getByText("失败 20%")).toBeInTheDocument();
    expect(screen.getByText("按失手的概率估")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /贴岸/ })).toHaveFocus());
    await user.keyboard("2");
    expect(await screen.findByText("预计 +4（顺利 +5，失手 +1）")).toBeInTheDocument();
    // 撤回再选
    await user.keyboard("{Backspace}");
    expect(screen.queryByText("预计 +4（顺利 +5，失手 +1）")).toBeNull();
    await user.keyboard("2");
    await user.keyboard("1");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { PlayContest: { owner: "player", contest: "c_race", moves: ["wind", "row"] } } }));
    await screen.findByRole("status", { name: "比赛结果" });
    const legs = document.querySelectorAll(".ct-legs > li");
    expect(within(legs[0] as HTMLElement).getByText("失手了")).toBeInTheDocument();
    expect(within(legs[1] as HTMLElement).getByText("顺利")).toBeInTheDocument();
  });

  const identify = base("identify", {
    samples: [
      { key: "s1", clues: ["汤色浅黄，入口一阵青气"] },
      { key: "s2", clues: ["汤色深如琥珀"] },
    ],
    answers: [
      { key: "light", name: "轻焙" },
      { key: "deep", name: "深焙" },
      { key: "stale", name: "陈茶" },
    ],
  });

  it("辨识：答案是一排按钮（数字键选、自动跳到下一份）；对错交卷前不给、只给全认对时的胜算；交卷后逐份写对错", async () => {
    const user = userEvent.setup();
    const calls = installIpc({
      contest: () => identify,
      contest_preview: (a) => ({ strength: 60, max_bonus: 15, best_bonus: 10, unit: 5, bonus: null, pct: null, base_pct: 42, best_pct: 64, ready: (a.moves as unknown[]).every((m) => m !== null), steps: [null, null], options: [] }),
      contest_outcome: () => ({ ...win, steps: [{ correct: true, answer: "light" }, { correct: false, answer: "deep" }] }),
    });
    render(<ContestDialog contest="c_identify" onClose={() => {}} />);
    expect(await screen.findByText("全认对约 64%")).toBeInTheDocument();
    expect(screen.getByText("对错交卷后揭晓")).toBeInTheDocument();
    expect(screen.queryByText(/照现在约/)).toBeNull();
    const one = screen.getByRole("listbox", { name: "样品 1" });
    await waitFor(() => expect(within(one).getByRole("option", { name: "轻焙" })).toHaveFocus());
    await user.keyboard("1");
    expect(within(one).getByRole("option", { name: "轻焙" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("listbox", { name: "样品 2" })).getByRole("option", { name: "轻焙" })).toHaveFocus();
    await user.keyboard("3");
    expect(screen.getByRole("button", { name: "交卷" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { PlayContest: { owner: "player", contest: "c_identify", moves: ["light", "stale"] } } }));
    expect(await screen.findByText("认对了")).toBeInTheDocument();
    expect(screen.getByText("认错了，是深焙")).toBeInTheDocument();
  });

  it("节奏：顶上写清怎么打；一打开焦点在“开始”上，空格开始、接着空格就是打拍，下面数着妙 / 好 / 偏", async () => {
    const user = userEvent.setup();
    const calls = installIpc({
      contest: () => base("rhythm", { bpm: 96, beats: [600, 1200, 1800], window: 150 }),
      contest_preview: (a) => ({ strength: 60, max_bonus: 16, best_bonus: 3, unit: 1, bonus: (a.moves as unknown[]).length, pct: 42, base_pct: 42, best_pct: 47, ready: true, steps: [], options: [] }),
    });
    render(<ContestDialog contest="c_rhythm" onClose={() => {}} />);
    expect(await screen.findByText("拍点走到竖线时按空格或点轨道。每打准一拍 +1，乱按会扣分。最多 +3。")).toBeInTheDocument();
    // 打开时只问一次“不打”的预估（打的时候不来回问后端）
    expect(calls).toHaveBeenCalledWith("contest_preview", { key: "c_rhythm", moves: [] });
    await waitFor(() => expect(screen.getByRole("button", { name: "开始" })).toHaveFocus());
    await user.keyboard(" ");
    expect(screen.queryByRole("button", { name: "开始" })).toBeNull();
    expect(screen.getByRole("button", { name: "拍点经过竖线时点这里，或按空格" })).toHaveFocus();
    expect(screen.getByText("妙 0 · 好 0 · 偏 0")).toBeInTheDocument();
    await user.keyboard(" ");
    expect(screen.queryByText("妙 0 · 好 0 · 偏 0")).toBeNull();
    expect(calls.mock.calls.filter((c) => c[0] === "contest_preview")).toHaveLength(1);
  });

  it("配对：刚翻的一对配没配上就地写出；方向键在牌桌上挪，回车翻牌", async () => {
    const user = userEvent.setup();
    installIpc({
      contest: () => base("match", { cols: 2, rows: 2, faces: ["松", "梅", "梅", "松"], flips: 4 }),
      contest_preview: (a) => ({ strength: 60, max_bonus: 12, best_bonus: 4, unit: 2, bonus: 0, pct: 42, base_pct: 42, best_pct: 50, ready: (a.moves as unknown[]).length > 0, steps: [], options: [] }),
    });
    render(<ContestDialog contest="c_match" onClose={() => {}} />);
    expect(await screen.findByText("翻两张，同面就配上。共 4 次机会，每配上一对 +2，随时可以收手。最多 +4。")).toBeInTheDocument();
    const card = (n: number) => document.querySelector<HTMLButtonElement>(`[data-card="${n - 1}"]`);
    await waitFor(() => expect(screen.getByRole("button", { name: "第 1 张（扣着）" })).toHaveFocus());
    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "第 2 张（扣着）" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("不是一对，记住它们的位置")).toBeInTheDocument();
    // 第 1 张与第 4 张是一对：↓ 到第 4 张翻开（没配上的两张这才扣回去），再 ←↑ 回到第 1 张
    await user.keyboard("{ArrowDown}");
    expect(card(4)).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(card(4)).toHaveClass("is-up");
    expect(card(2)).not.toHaveClass("is-up");
    await user.keyboard("{ArrowLeft}{ArrowUp}");
    expect(card(1)).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("配上了！+2")).toBeInTheDocument();
    // 配上的牌不能再点；焦点挪到下一张还扣着的牌上，键盘接着能用
    expect(document.activeElement?.tagName).toBe("BUTTON");
    expect(document.activeElement).not.toBeDisabled();
    await act(async () => {});
  });
});
