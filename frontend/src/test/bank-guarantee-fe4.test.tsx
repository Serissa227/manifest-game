// R10-FE4：“家里作保”在钱庄与结业清单里看得见；标题画面直接读档失败写人话。真值表（bankGuarantee.ts 顶上同一张）逐行一条：
// | 有这一段 | available | reason          | 柜台金额 ≤ amount | → 画什么 |
// | 否       | —         | —               | —                 | 什么都不画 |
// | 是       | true      | （任意）         | 否（或金额 ≤ 0）  | 标题、说明、“填上 {amount}” |
// | 是       | true      | （任意）         | 是                | 再加借款按钮下的“这一笔走家里的保” |
// | 是       | false     | precondition    | —                 | 标题、“已经用过了” |
// | 是       | false     | wrong_location  | —                 | 标题、“只在家乡那座港的钱庄认” |
// | 是       | false     | not_owner / 别的 / 没有 | —         | 什么都不画 |
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PortPanel from "../components/panels/PortPanel";
import { guaranteeRateBp, guaranteeShow, type GuaranteeKind } from "../components/panels/bankGuarantee";
import { useShell } from "../components/shell/shellState";
import StartScreen from "../components/StartScreen";
import { SkipCapital } from "../components/upbringing/act/ActK2";
import { applySlots, draftOf, problemStale } from "../components/upbringing/ubKit";
import type { ActNames } from "../components/upbringing/act/actKit";
import { setLocale } from "../i18n/locale";
import type { ActView, CapitalPreview } from "../ipc/actTypes";
import type { BankView, PortView } from "../ipc/types";
import { useGame } from "../store/game";
import { applyUi, useUiVersion } from "../ui/uiMode";
import { installIpc, port, startedGame, statics } from "./fixtures";

type G = BankView["guarantee"];
const G0 = { amount: 1500, rate_pct: 50 };

// 穷举：有没有这一段 × available × reason（无 / precondition / wrong_location / not_owner / 别的）× 柜台金额（0、1、1500、1501）
const ROWS: { g: G; amount: number; kind: GuaranteeKind; applies: boolean }[] = [];
for (const has of [false, true])
  for (const available of [true, false])
    for (const reason of [undefined, "precondition", "wrong_location", "not_owner", "other"])
      for (const amount of [0, 1, 1500, 1501]) {
        const g: G = has ? { ...G0, available, ...(reason ? { reason } : {}) } : undefined;
        const kind: GuaranteeKind = !has ? "none" : available ? "offer" : reason === "precondition" ? "used" : reason === "wrong_location" ? "home" : "none";
        ROWS.push({ g, amount, kind, applies: kind === "offer" && amount > 0 && amount <= 1500 });
      }

describe("R10-FE4 家里作保：真值表（guaranteeShow，穷举）", () => {
  it.each(ROWS)("g=%j", ({ g, amount, kind, applies }) => {
    expect(guaranteeShow(g, amount)).toEqual({ kind, applies });
  });
  it("走保的年息 = 平常 × rate_pct ÷ 100", () => {
    expect(guaranteeRateBp(1200, 50)).toBe(600);
    expect(guaranteeRateBp(901, 50)).toBe(450);
  });
});

function openBank(g: G) {
  installIpc({ port: () => ({ ...port, loc: 0, bank: { ...port.bank, rate_bp: 1200, ...(g ? { guarantee: g } : {}) } }) as PortView });
  startedGame();
  useGame.setState({ facility: "bank", selectedLoc: 0, message: null, error: null });
  useShell.setState({ windowOpen: false });
  render(<PortPanel />);
}

describe.each(["v1", "v2"] as const)("R10-FE4 钱庄里画出来（%s）", (ui) => {
  beforeEach(() => {
    setLocale("zh-CN");
    applyUi(ui);
    useUiVersion.setState({ ui });
  });
  afterEach(() => cleanup());

  it("没有这一段：什么都不加", async () => {
    openBank(undefined);
    await screen.findByTestId("bank");
    expect(screen.queryByTestId("bank-guarantee")).toBeNull();
  });
  it("能用：标题、说明、“填上 1,500”；点了把柜台金额填成 1500，借款按钮下写走保的年息", async () => {
    const user = userEvent.setup();
    openBank({ ...G0, available: true });
    const box = await screen.findByTestId("bank-guarantee");
    expect(within(box).getByText("家里作保")).toBeInTheDocument();
    expect(box).toHaveTextContent("头一笔借款在 1,500 金币以内的，利息照平常的 50% 算。只这一回。");
    // 柜台缺省 1000 ≤ 1500：这一笔走保
    expect(screen.getByTestId("bank-guarantee-applies")).toBeInTheDocument();
    const input = screen.getByRole("spinbutton", { name: "金额" });
    await user.clear(input);
    await user.type(input, "1501");
    await waitFor(() => expect(screen.queryByTestId("bank-guarantee-applies")).toBeNull());
    await user.click(within(box).getByRole("button", { name: "填上 1,500" }));
    expect(input).toHaveValue(1500);
    expect(await screen.findByTestId("bank-guarantee-applies")).toHaveTextContent("这一笔走家里的保：年息 6%（平常 12%）。");
  });
  it("用过了：标题 + “家里作的保已经用过了。”", async () => {
    openBank({ ...G0, available: false, reason: "precondition" });
    expect(await screen.findByTestId("bank-guarantee-used")).toHaveTextContent("家里作的保已经用过了。");
  });
  it("不在本据港：标题 + “家里作的保只在家乡那座港的钱庄认。”", async () => {
    openBank({ ...G0, available: false, reason: "wrong_location" });
    expect(await screen.findByTestId("bank-guarantee-home")).toHaveTextContent("家里作的保只在家乡那座港的钱庄认。");
  });
  it("not_owner：不画", async () => {
    openBank({ ...G0, available: false, reason: "not_owner" });
    await screen.findByTestId("bank");
    expect(screen.queryByTestId("bank-guarantee")).toBeNull();
  });
});

describe("R10-FE4 结业清单里的作保", () => {
  const names = { item: (k: string) => k, person: (k: string) => k, duty: (k: string) => k } as unknown as ActNames;
  const cap = (g?: CapitalPreview["guarantee"]): ActView =>
    ({ rumors: null, capital_preview: { band: "bing", aspiration: null, fulfilled: false, value: 0, rows: [], savings: { cash: 0, given: 0, kept: 0, score: 0 }, ...(g ? { guarantee: g } : {}) } }) as unknown as ActView;
  it("带 guarantee：清单下面加那一句（“跳过养成”与手账同一份清单）", () => {
    render(<SkipCapital act={cap({ amount: 1500, rate_pct: 50 })} names={names} />);
    expect(screen.getByTestId("ua-capital-guarantee")).toHaveTextContent("头一笔 1500 文以内的借款利息照平常的 50% 算");
    cleanup();
  });
  it("不带：不画", () => {
    render(<SkipCapital act={cap()} names={names} />);
    expect(screen.queryByTestId("ua-capital-guarantee")).toBeNull();
    cleanup();
  });
});

describe("R10-FE4 标题画面直接读档失败", () => {
  beforeEach(() => useGame.setState({ statics, overview: null, version: 0, error: null, message: null }));
  afterEach(() => cleanup());
  const save = { slot: "save1", day: 30, scenario: "更远之处", net_worth: 500, modified: 80 };
  it("存档不存在：写“没有叫“save1”的存档。”，原文只进控制台", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installIpc({ list_saves: () => [save], load_game: () => Promise.reject("存档读写失败：读取存档失败：系统找不到指定的文件。 (os error 2)") });
    const user = userEvent.setup();
    render(<StartScreen roll={3} />);
    await user.click(await screen.findByTestId("start-continue"));
    await waitFor(() => expect(useGame.getState().error).toBe("没有叫“save1”的存档。"));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it("别的原因：写“save1”没读成那一句，不接原文", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installIpc({ list_saves: () => [save], load_game: () => Promise.reject("存档读写失败：存档版本不兼容") });
    const user = userEvent.setup();
    render(<StartScreen roll={3} />);
    await user.click(await screen.findByTestId("start-continue"));
    await waitFor(() => expect(useGame.getState().error).toBe("“save1”没读成。换一份存档，或者重开游戏再试。"));
    warn.mockRestore();
  });
});

describe("R10-FE4 周条上的“N 日排不上”（家乡的旧周程，X15 巴拉卡第 1 周的样子）", () => {
  const slot = (index: number) => ({ index, label: `${index + 1} 日`, column: "free", status: "empty", lesson: null, after: null, timetable: { lesson: null, after: null } });
  const v = {
    stage: "home",
    lessons: [],
    activities: [],
    plan: { month: [1553, 1], editable: true, mode: "week", week: 1, weeks: 4, next_slot: 0, slots: [0, 1, 2].map(slot), timetable_problem: { index: 1, reason: "这一格还没有排" } },
  } as unknown as Parameters<typeof problemStale>[0];
  it("草稿里那一格还空着 → 照旧显示", () => {
    expect(problemStale(v, draftOf(v.plan))).toBe(false);
  });
  it("“自动安排”排满（那一格排上了）→ 不显示", () => {
    const d = applySlots(draftOf(v.plan), [0, 1, 2].map((index) => ({ index, after: { activity: "visit" } })));
    expect(problemStale(v, d)).toBe(true);
  });
});
