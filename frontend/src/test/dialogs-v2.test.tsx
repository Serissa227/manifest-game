// 新界面第二阶段 dialogs 组（docs/UI-REDESIGN.md 第 8 节第 7 行与第 9 节）：v2 下的小 DOM 调整与行为，v1 维持原样。
// - 遭遇海盗：两个选择下各写一句会发生什么（按钮的 aria-describedby 指过去），点了照旧提交 EngageBattle、战术海战转到海战页；
// - 战术海战：棋盘下的图例、命令台（转向、开火、撤退、结束回合收在一起，照旧提交 TacticalCommand）；没有海战时的“回到航海图”；
// - 新手教程：说明框里的快捷键（← → 翻页、Esc 跳过）。
// - 评审后的修正：样式表里不散写色值（本组的局部颜色集中定义）、不改对话框的 image-rendering（插图与 v1 一像素不差）。
// - 第二轮评审后的修正：比赛的交卷按钮（就到这里 / 吟出 / 交卷）不可用时与别处同一个样子，并就地写出还差什么；
//   半透明的色值（rgba）也收进局部颜色，动画帧一起查。
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import BattleDialog from "../components/BattleDialog";
import ContestDialog from "../components/contests/ContestDialog";
import TacticalPanel from "../components/panels/TacticalPanel";
import { useShell } from "../components/shell/shellState";
import Tutorial from "../components/tutorial/Tutorial";
import { resetTutorial } from "../components/tutorial/tutorialState";
import { setLocale } from "../i18n/locale";
import type { ContestView } from "../ipc/types";
import { useGame } from "../store/game";
import { applyUi, useUiVersion } from "../ui/uiMode";
import { installIpc, overview, startedGame, statics } from "./fixtures";

function setUiFor(ui: "v1" | "v2") {
  applyUi(ui);
  useUiVersion.setState({ ui });
}

const pirates = { ...overview, pending_battles: [{ id: 4, fleet: 0, pirate_ships: 2, pirate_guns: 16, pirate_crew: 40 }] };
const inBattle = { ...overview, tactical_battles: [4] };

beforeEach(() => {
  setLocale("zh-CN");
});
afterEach(() => {
  cleanup();
  setUiFor("v1");
});

describe("遭遇海盗（v2）", () => {
  it("两个选择各带一句会发生什么；按钮名字不变，点了照旧提交，战术海战转到海战页", async () => {
    const calls = installIpc();
    startedGame();
    useGame.setState({ overview: pirates });
    setUiFor("v2");
    const user = userEvent.setup();
    render(<BattleDialog />);
    const auto = screen.getByRole("button", { name: "自动结算" });
    const tactical = screen.getByRole("button", { name: "战术海战" });
    expect(auto).toHaveAccessibleDescription("按双方的船、炮与船员，马上算出胜负");
    expect(tactical).toHaveAccessibleDescription("在六角格上亲自指挥：移动、转向、开炮、接舷");
    expect(tactical).toHaveClass("btn", "primary");
    await user.click(tactical);
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", { command: { EngageBattle: { owner: "player", battle: 4, tactical: true } } }),
    );
    expect(useGame.getState().tab).toBe("battle");
  });

  it("v1 照旧：一行两个按钮，没有说明", () => {
    installIpc();
    startedGame();
    useGame.setState({ overview: pirates });
    render(<BattleDialog />);
    expect(document.querySelector(".bt-choices")).toBeNull();
    expect(screen.getByRole("button", { name: "自动结算" })).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText("按双方的船、炮与船员，马上算出胜负")).toBeNull();
  });
});

describe("战术海战（v2）", () => {
  it("棋盘下有图例；命令收进命令台，转向、开火、撤退、结束回合照旧提交", async () => {
    const calls = installIpc({ submit: () => ({ outcome: "Done", overview: inBattle }) });
    startedGame();
    useGame.setState({ overview: inBattle });
    setUiFor("v2");
    const user = userEvent.setup();
    render(<TacticalPanel />);
    const dock = await screen.findByTestId("tactical-dock");
    const legend = screen.getByRole("list", { name: "图例" });
    expect(within(legend).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "可以移动到的格子",
      "射程内的敌船：点它开火",
      "你正在指挥的船",
    ]);
    const order = (o: unknown) => ({ command: { TacticalCommand: { owner: "player", battle: 4, order: o } } });
    await user.click(within(dock).getByRole("button", { name: "东南" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", order({ Turn: { unit: 0, facing: 5 } })));
    await user.click(within(dock).getByRole("button", { name: "开火 #1" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", order({ Fire: { unit: 0, target: 1 } })));
    await user.click(within(dock).getByRole("button", { name: "撤退" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", order("Retreat")));
    await user.click(within(dock).getByRole("button", { name: "结束回合" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", order("EndTurn")));
  });

  it("没有进行中的海战：说明为什么空，“回到航海图”切到航海图并合上窗口", async () => {
    installIpc();
    startedGame();
    useShell.setState({ windowOpen: true });
    setUiFor("v2");
    const user = userEvent.setup();
    render(<TacticalPanel />);
    const empty = screen.getByTestId("empty-state");
    expect(empty).toHaveTextContent("没有进行中的海战");
    await user.click(within(empty).getByRole("button", { name: "回到航海图" }));
    expect(useGame.getState().stage).toBe("chart");
    expect(useShell.getState().windowOpen).toBe(false);
  });

  it("v1 照旧：没有图例与命令台，空的时候只有一行字", async () => {
    installIpc();
    startedGame();
    useGame.setState({ overview: inBattle });
    const { unmount } = render(<TacticalPanel />);
    await screen.findByRole("button", { name: "结束回合" });
    expect(document.querySelector(".bt-dock, .bt-legend")).toBeNull();
    unmount();
    useGame.setState({ overview });
    render(<TacticalPanel />);
    expect(screen.getByText("没有进行中的海战")).toHaveClass("empty");
    expect(screen.queryByRole("button", { name: "回到航海图" })).toBeNull();
  });
});

describe("新手教程（v2）", () => {
  it("说明框里列出能用的键：← → 翻页、Esc 跳过；v1 没有", () => {
    installIpc();
    startedGame();
    resetTutorial();
    useGame.setState({ overview: { ...overview, day: 0 } });
    const { unmount } = render(<Tutorial />);
    expect(screen.getByTestId("tutorial")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "快捷键" })).toBeNull();
    unmount();
    resetTutorial();
    act(() => setUiFor("v2"));
    render(<Tutorial />);
    const keys = screen.getByRole("list", { name: "快捷键" });
    expect(within(keys).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["←左箭头→右箭头翻页", "EscEsc跳过教程"]);
  });
});

describe("比赛对话框（v2，第二轮评审后的修正）", () => {
  const contest = (kind: ContestView["kind"], params: Record<string, unknown>): ContestView => ({
    key: `c_${kind}`,
    name: "七夕的歌合",
    kind,
    seed: 7,
    params,
    rivals: [],
    auto_pct: 42,
  });
  const poem = contest("poem", { theme: "七夕", lines: [{ prompt: "银河＿", options: ["流", "远"] }, { prompt: "＿叶上", options: ["梶", "竹"] }], hints: [] });
  const identify = contest("identify", {
    samples: [
      { key: "s1", clues: ["香气清冽"] },
      { key: "s2", clues: ["回甘"] },
    ],
    answers: [
      { key: "uji", name: "宇治" },
      { key: "toga", name: "栂尾" },
    ],
  });
  const match = contest("match", { cols: 2, rows: 1, faces: ["松", "梅"], flips: 1 });
  beforeEach(() => {
    useGame.setState({ statics, overview, version: 1, error: null, message: null });
  });

  it("作诗：“吟出”不可用时上面就地写出还差几句，按钮指过去；选齐了原因消失、照旧提交", async () => {
    const calls = installIpc({ contest: () => poem });
    setUiFor("v2");
    const user = userEvent.setup();
    render(<ContestDialog contest="c_poem" onClose={() => {}} />);
    const go = await screen.findByRole("button", { name: "吟出" });
    expect(go).toBeDisabled();
    expect(go).toHaveAccessibleDescription("每句都挑好一个词才能吟出（还差 2 句）");
    // 原因紧挨在按钮前面（同一个父元素、就在它上面）
    expect(go.previousElementSibling).toHaveClass("v2-inline-error", "is-blocked", "ct-why");
    await user.click(within(screen.getByRole("radiogroup", { name: "第 1 句" })).getByRole("radio", { name: "远" }));
    expect(go).toHaveAccessibleDescription("每句都挑好一个词才能吟出（还差 1 句）");
    await user.click(within(screen.getByRole("radiogroup", { name: "第 2 句" })).getByRole("radio", { name: "梶" }));
    expect(go).toBeEnabled();
    expect(go).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByTestId("inline-error")).toBeNull();
    await user.click(go);
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { PlayContest: { owner: "player", contest: "c_poem", moves: [1, 0] } } }));
  });

  it("辨识：“交卷”不可用时写出还差几份；配对：还没翻牌时“就到这里”写出为什么", async () => {
    installIpc({ contest: (a) => (a.key === "c_identify" ? identify : match) });
    setUiFor("v2");
    const user = userEvent.setup();
    const { unmount } = render(<ContestDialog contest="c_identify" onClose={() => {}} />);
    const hand = await screen.findByRole("button", { name: "交卷" });
    expect(hand).toHaveAccessibleDescription("每份样品都认一个答案才能交卷（还差 2 份）");
    await user.selectOptions(screen.getByLabelText("样品 1"), "toga");
    expect(hand).toHaveAccessibleDescription("每份样品都认一个答案才能交卷（还差 1 份）");
    await user.selectOptions(screen.getByLabelText("样品 2"), "uji");
    expect(hand).toBeEnabled();
    expect(hand).not.toHaveAttribute("aria-describedby");
    unmount();
    render(<ContestDialog contest="c_match" onClose={() => {}} />);
    const stop = await screen.findByRole("button", { name: "就到这里" });
    expect(stop).toBeDisabled();
    expect(stop).toHaveAccessibleDescription("至少翻完一对（两张）牌，才能就此收手");
    await user.click(screen.getByRole("button", { name: "第 1 张（扣着）" }));
    await user.click(screen.getByRole("button", { name: "第 2 张（扣着）" }));
    const done = screen.getByRole("button", { name: "交卷" });
    expect(done).toBeEnabled();
    expect(done).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByTestId("inline-error")).toBeNull();
  });

  it("v1 照旧：按钮只是不可用，旁边没有原因，也没有 aria-describedby", async () => {
    installIpc({ contest: () => poem });
    render(<ContestDialog contest="c_poem" onClose={() => {}} />);
    const go = await screen.findByRole("button", { name: "吟出" });
    expect(go).toBeDisabled();
    expect(go).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByTestId("inline-error")).toBeNull();
    expect(document.querySelector(".ct-why")).toBeNull();
  });
});

describe("dialogs.css（评审后的修正）", () => {
  // 测试环境不处理 CSS，直接用 Node 读原文；路径放在变量里（写成字面量时 Vite 会改写 new URL）
  const file = "../styles/ui-v2/dialogs.css";
  const css = readFileSync(new URL(file, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  /** 拆成（选择器，声明块）；媒体查询、动画帧等 @ 规则往里走一层（动画帧的“选择器”是 0%、50% 之类）。 */
  function rules(text: string): { head: string; body: string }[] {
    const out: { head: string; body: string }[] = [];
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith("@")) out.push(...rules(body));
      else out.push({ head, body });
      i = j;
    }
    return out;
  }
  const all = rules(css);

  it("色值只在一处定义：本组的局部颜色（:root[data-ui=\"v2\"] 上的 --dlg-*），其余规则（含动画帧）里不写 #rrggbb，也不写 rgb() / rgba() / hsl() / hsla()", () => {
    const defs = all.filter((r) => r.head === ':root[data-ui="v2"]');
    expect(defs).toHaveLength(1);
    expect(defs[0].body).toMatch(/--dlg-violet:\s*#5a4a78/);
    // 半透明的颜色（遮罩、外框、印章红的描边……）也收在定义块里
    expect(defs[0].body).toMatch(/--dlg-scrim:\s*rgba\(6, 11, 20, 0\.66\)/);
    // 动画帧确实拆进来查了：v2-tut-glow 有“0%, 100%”与“50%”两帧
    expect(all.filter((r) => /^\d+%/.test(r.head))).toHaveLength(2);
    const color = /#[0-9a-f]{3,8}(?![\w-])|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i;
    const loose = all.filter((r) => r.head !== ':root[data-ui="v2"]' && color.test(r.body)).map((r) => r.head);
    expect(loose).toEqual([]);
  });

  it("比赛的交卷按钮不可用时与本组其他不可用的按钮同一个样子：重置 v1 .ts-btn:disabled 的 opacity 与 grayscale（不然字只剩 2:1）", () => {
    const rule = all.find((r) => r.head === ':root[data-ui="v2"] .ct-dialog .ts-btn:disabled');
    expect(rule?.body).toMatch(/opacity:\s*1;/);
    expect(rule?.body).toMatch(/filter:\s*none;/);
    expect(rule?.body).toMatch(/color:\s*var\(--dlg-off-ink\);/);
  });

  it("不改对话框外框的 image-rendering（v1 的 .modal-body 是 pixelated，里面的 Q 版小人与立绘继承它）", () => {
    // 选中外框本身的规则：某个选择器以 .pn-battle-body 结尾
    const frames = all.filter((r) => r.head.split(",").some((sel) => /\.pn-battle-body$/.test(sel.trim())));
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.filter((r) => /image-rendering/.test(r.body)).map((r) => r.head)).toEqual([]);
  });
});
