// 新界面（海图室）桌面的一行顶栏：
// 与平板同一个紧凑顶栏，桌面上另外写出名声、殖民地、剧本目标（百分比与细进度）、待报告的发现、“故事”，以及一次点到的“存档”；
// 数字那一格放不下时整项让位（样式里折行裁掉），不切半个数字。旧界面（经典像素）的桌面顶栏照旧。概览为模拟数据。
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../App";
import TopBar from "../components/TopBar";
import { useShell } from "../components/shell/shellState";
import { STEPS } from "../components/tutorial/steps";
import { useTutorial } from "../components/tutorial/tutorialState";
import type { Overview } from "../ipc/types";
import { useGame } from "../store/game";
import { applyUi, useUiVersion } from "../ui/uiMode";
import { installIpc, overview, startedGame } from "./fixtures";

function setUiFor(ui: "v1" | "v2") {
  applyUi(ui);
  useUiVersion.setState({ ui });
}

function show(patch: Partial<Overview> = {}) {
  useGame.setState({ overview: { ...overview, ...patch } });
  return render(<TopBar />);
}

// 路径放在变量里：写成字面量时 Vite 会把 new URL(…, import.meta.url) 改写成网页里的资源地址
const SHELL_CSS = "../styles/ui-v2/shell.css";
const COMPACT_CSS = "../styles/compact.css";
const shellCss = readFileSync(new URL(SHELL_CSS, import.meta.url), "utf8");
const compactCss = readFileSync(new URL(COMPACT_CSS, import.meta.url), "utf8");

/** 样式表里某个媒体查询的整段内容（到与它配对的右花括号为止）。 */
function mediaBlock(css: string, query: string): string {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf(`@media ${query}`, from);
    if (at < 0) break;
    const open = css.indexOf("{", at);
    let depth = 1;
    let i = open + 1;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    out.push(css.slice(open + 1, i - 1));
    from = i;
  }
  return out.join("\n");
}

/** 一条规则的声明（选择器以 `tail` 结尾、不在媒体查询里的那一条）。 */
function ruleOf(css: string, tail: string): string {
  const plain = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  const m = new RegExp(`${tail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(plain);
  return m ? m[1] : "";
}

beforeEach(() => {
  setUiFor("v1");
  startedGame();
});
afterEach(() => {
  cleanup();
  setUiFor("v1");
});

describe("新界面桌面的一行顶栏", () => {
  it("是紧凑顶栏：现金、净资产、目标、名声、殖民地排在数字那一格里（按这个先后，后面的先让位）；时刻与倍速照旧", () => {
    installIpc();
    setUiFor("v2");
    show({ fame: 7 });
    const hud = screen.getByTestId("hud");
    expect(hud).toHaveClass("hud-compact");
    expect(hud).toHaveAttribute("data-layout", "desktop");
    const stats = hud.querySelector(".hud-stats") as HTMLElement;
    const order = [...stats.children].map((e) => [...e.classList].find((c) => /^hud-(cash|net|goal-stat|fame|colonies)$/.test(c)));
    expect(order).toEqual(["hud-cash", "hud-net", "hud-goal-stat", "hud-fame", "hud-colonies"]);
    expect(within(stats).getByTestId("cash")).toHaveTextContent("12,345 金币");
    expect(within(stats).getByTestId("fame")).toHaveTextContent("7");
    expect(within(stats).getByTestId("colonies")).toHaveTextContent("0 座");
    expect(screen.getByTestId("date")).toHaveTextContent("1502年1月13日（春）");
    expect(screen.getByRole("button", { name: "暂停" })).toBeInTheDocument();
    // 旧的两三行顶栏里的存档槽输入框与目标全文一行不在顶栏上
    expect(hud.querySelector(".saves")).toBeNull();
    expect(screen.queryByTestId("goal")).toBeNull();
  });

  it("目标一格：写“目标”与完成的百分比，细进度是读屏用的进度条；全文与限期在悬停提示里", () => {
    installIpc();
    setUiFor("v2");
    show();
    const goal = screen.getByTestId("goal-stat");
    expect(goal).toHaveTextContent("目标");
    expect(goal).toHaveTextContent("6%");
    expect(goal).toHaveAttribute("title", "目标：净资产 20,000 / 300,000 金币（限 1512年1月1日前）");
    const bar = within(goal).getByRole("progressbar", { name: "剧本目标进度" });
    expect(bar).toHaveAttribute("aria-valuenow", "6");
    expect(bar.getAttribute("aria-valuetext")).toContain("限 1512年1月1日前");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("6%");
  });

  it("自由经营（没有目标）：不画目标一格", () => {
    installIpc();
    setUiFor("v2");
    show({ goal: null });
    expect(screen.queryByTestId("goal-stat")).toBeNull();
    expect(screen.getByTestId("cash")).toBeInTheDocument();
  });

  it("待报告的发现：提醒键在数字那一格外面（那一格放不下会整项收掉，提醒不能跟着没了），点了打开探险窗口", async () => {
    installIpc();
    setUiFor("v2");
    show({ discoveries_unreported: 2 });
    const user = userEvent.setup();
    const hud = screen.getByTestId("hud");
    const alertBtn = within(hud).getByTestId("discoveries-unreported");
    expect(alertBtn).toHaveTextContent("2");
    expect(alertBtn.closest(".hud-stats")).toBeNull();
    useShell.setState({ windowOpen: false });
    await user.click(alertBtn);
    expect(useGame.getState().tab).toBe("explore");
    expect(useShell.getState().windowOpen).toBe(true);
  });

  it("存档一次点到：存到“菜单”里写的槽位（缺省 save1），提示里写明槽位；在菜单里换了槽位跟着换", async () => {
    const calls = installIpc({ save_game: (args) => ({ slot: args.slot }) });
    setUiFor("v2");
    show();
    const user = userEvent.setup();
    const save = screen.getByTestId("hud-quick-save");
    expect(save).toHaveAccessibleName("存档到“save1”（换槽位、读档在“菜单”里）");
    expect(save).toHaveAttribute("title", "存档到“save1”（换槽位、读档在“菜单”里）");
    await user.click(save);
    await waitFor(() => expect(calls).toHaveBeenCalledWith("save_game", { slot: "save1" }));
    await waitFor(() => expect(useGame.getState().message).toContain("save1"));
    // 菜单里改槽位名
    await user.click(screen.getByTestId("hud-menu-button"));
    const sheet = await screen.findByTestId("hud-sheet");
    const input = within(sheet).getByRole("textbox", { name: "存档名" });
    await user.clear(input);
    await user.type(input, "出海前");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("hud-sheet")).toBeNull());
    const again = screen.getByTestId("hud-quick-save");
    expect(again).toHaveAccessibleName("存档到“出海前”（换槽位、读档在“菜单”里）");
    await user.click(again);
    await waitFor(() => expect(calls).toHaveBeenCalledWith("save_game", { slot: "出海前" }));
  });

  it("旧界面（经典像素）的桌面顶栏照旧：两三行，目标全文一行，存档槽与存读档在顶栏上，没有一次点到的存档键", () => {
    installIpc();
    setUiFor("v1");
    show({ discoveries_unreported: 1 });
    const hud = screen.getByTestId("hud");
    expect(hud).not.toHaveClass("hud-compact");
    expect(screen.getByTestId("goal")).toHaveTextContent("目标：净资产 20,000 / 300,000 金币（限 1512年1月1日前）");
    expect(hud.querySelector(".saves input")).not.toBeNull();
    expect(screen.queryByTestId("hud-quick-save")).toBeNull();
    expect(screen.queryByTestId("goal-stat")).toBeNull();
    // 旧顶栏里待报告的发现仍与名声、殖民地在同一格
    expect(screen.getByTestId("discoveries-unreported").closest(".hud-stats")).not.toBeNull();
  });
});

describe("新手教程在一行顶栏上（新界面的桌面）", () => {
  const step = (id: string) => STEPS.findIndex((s) => s.id === id);

  beforeEach(() => {
    installIpc();
    useShell.setState({ windowOpen: true });
    useTutorial.setState({ active: false, done: true, step: 0 });
  });
  afterEach(() => useTutorial.setState({ active: false, done: true, step: 0 }));

  it("现金、目标、存档三步换成一行顶栏的说法：净资产就在旁边、目标指上去看全文、存档一点就存", async () => {
    setUiFor("v2");
    render(<App />);
    await screen.findByTestId("hud");
    act(() => useTutorial.setState({ active: true, step: step("cash") }));
    expect(screen.getByTestId("tutorial-text")).toHaveTextContent("这里是现金与净资产");
    expect(screen.getByTestId("tutorial-text")).toHaveTextContent("总资产在右上角的“菜单”里");
    act(() => useTutorial.setState({ step: step("goal") }));
    expect(screen.getByTestId("tutorial-text")).toHaveTextContent("这里是剧本目标完成了多少，指上去看目标全文");
    act(() => useTutorial.setState({ step: step("save") }));
    expect(screen.getByTestId("tutorial-text")).toHaveTextContent("这枚键一点就存；换存档名、读档在旁边的“菜单”里");
    // 没有专门说法的步骤照旧
    act(() => useTutorial.setState({ step: step("town") }));
    expect(screen.getByTestId("tutorial-text")).toHaveTextContent("这是港口街景！");
  });

  it("圈的地方：目标一步先找目标一格（窄窗口里它收掉了就圈现金下面的细进度，再不行圈菜单），存档一步圈存档键；别的布局用的目标不变", () => {
    expect(STEPS[step("goal")].rowTarget).toEqual([".hud-goal-stat", ".hud-goal", ".hud-menu-btn"]);
    expect(STEPS[step("save")].rowTarget).toEqual([".hud-save-btn", ".hud-menu-btn"]);
    expect(STEPS[step("goal")].target).toEqual([".hud-goal", ".hud-menu-btn"]);
    expect(STEPS[step("save")].target).toEqual([".saves", ".hud-menu-btn"]);
    // 这些类名确实是顶栏里的元素
    setUiFor("v2");
    show();
    const hud = screen.getByTestId("hud");
    for (const sel of [".hud-goal-stat", ".hud-save-btn", ".hud-menu-btn", ".hud-cash"]) expect(hud.querySelector(sel)).not.toBeNull();
  });

  it("旧界面的桌面：说法照旧（现金、净资产与总资产都在顶栏上）", async () => {
    setUiFor("v1");
    render(<App />);
    await screen.findByTestId("hud");
    act(() => useTutorial.setState({ active: true, step: step("cash") }));
    expect(screen.getByTestId("tutorial-text")).toHaveTextContent("这里是现金、净资产与总资产");
    act(() => useTutorial.setState({ step: step("goal") }));
    expect(screen.getByTestId("tutorial-text")).toHaveTextContent("剧本的目标、进度和期限写在这里");
  });
});

describe("一行顶栏的样式约定（styles/ui-v2/shell.css）", () => {
  const DESK = ':root[data-ui="v2"] .app.game[data-layout="desktop"] .hud-compact';

  it("数字那一格：折行、定高，放不下的整项被裁掉（不是把一格从中间切开）；每一格自己不收缩", () => {
    const stats = ruleOf(shellCss, `${DESK} .hud-stats`);
    expect(stats).toMatch(/flex-wrap:\s*wrap/);
    expect(stats).toMatch(/align-content:\s*flex-start/);
    expect(stats).toMatch(/height:\s*40px/);
    // 行距大于一行剩下的高度：第二行整行落在这一格之外
    const rowGap = /gap:\s*(\d+)px\s+\d+px/.exec(stats);
    expect(rowGap).not.toBeNull();
    expect(Number(rowGap?.[1])).toBeGreaterThanOrEqual(6);
    expect(ruleOf(compactCss, ".hud-compact .hud-stats")).toMatch(/overflow:\s*hidden/);
    expect(ruleOf(compactCss, ".hud-compact .hud-stat")).toMatch(/flex:\s*none/);
  });

  it("日期与时刻天气排成上下两行（不占横向的地方）", () => {
    expect(ruleOf(shellCss, `${DESK} .hud-clock-row`)).toMatch(/flex-direction:\s*column/);
    expect(ruleOf(shellCss, `${DESK} .hud-time`)).toMatch(/flex-direction:\s*row/);
  });

  it("按宽度让位：窄于 1600 暂停与“下一天”、存档只留图标；窄于 1440 收掉所在；窄于 1320 收掉风、名声、殖民地与目标一格，目标换回现金下面的细进度", () => {
    const lt1600 = mediaBlock(shellCss, "(max-width: 1599px)");
    expect(lt1600).toContain(`${DESK} .speed .speed-label`);
    expect(lt1600).toContain(`${DESK} .hud-save-label`);
    const lt1440 = mediaBlock(shellCss, "(max-width: 1439px)");
    expect(lt1440).toContain(`${DESK} .hud-where`);
    const lt1320 = mediaBlock(shellCss, "(max-width: 1319px)");
    for (const cls of [".hud-wind", ".hud-fame", ".hud-colonies", ".hud-goal-stat"]) expect(lt1320).toContain(`${DESK} ${cls}`);
    expect(lt1320).toMatch(/\.hud-goal-mini\s*\{\s*display:\s*block/);
    // 宽的时候现金下面那条细进度不重复画
    expect(ruleOf(shellCss, `${DESK} .hud-goal-mini`)).toMatch(/display:\s*none/);
    // 现金从不在让位的名单里
    for (const block of [lt1600, lt1440, lt1320]) expect(block).not.toContain(".hud-cash {");
  });
});
