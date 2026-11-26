// 三档倍速、倍速快捷键、在港暂停与旅店：
// 键盘 1 / 2 / 3 切慢 / 普通 / 快（输入框里打字、按着 Ctrl、对话框开着时不理会）；旗舰队在港（Overview.port_hold）时倍速控件变灰、
// 写明原因、点“在港 · 去旅店”打开旅店页；旅店休息一天一天地推进、显示进度、可以中途起床、遇到要回应的事提前起来并说明原因。
// 模拟的 Tauri IPC，不调用任何真实服务。
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import PortPanel from "../components/panels/PortPanel";
import { INN_PACE } from "../components/port/innKit";
import { useShell } from "../components/shell/shellState";
import TopBar from "../components/TopBar";
import { t, tk } from "../i18n";
import { setLocale } from "../i18n/locale";
import type { Overview, PortHoldView } from "../ipc/types";
import { useGame } from "../store/game";
import { nearestTier, SPEED_TIERS } from "../time/daylight";
import { installIpc, overview, startedGame } from "./fixtures";

const HOLD: PortHoldView = { loc: 0, resume: 8, month_days: 18 };
const speedsOf = (calls: ReturnType<typeof installIpc>) =>
  calls.mock.calls.filter(([cmd]) => cmd === "set_speed").map(([, args]) => args.speed);
const stepsOf = (calls: ReturnType<typeof installIpc>) => calls.mock.calls.filter(([cmd]) => cmd === "step").map(([, args]) => args);

beforeEach(() => {
  setLocale("zh-CN");
  useShell.setState({ windowOpen: false });
  INN_PACE.ms = () => 0;
});
afterEach(() => {
  cleanup();
  document.querySelectorAll("[data-test-modal]").forEach((el) => el.remove());
});

describe("三档倍速", () => {
  it("慢 / 普通 / 快就是 2× / 4× / 8×；旧的倍速归到最近的一档", () => {
    expect(SPEED_TIERS).toEqual([2, 4, 8]);
    expect([0, 1, 2, 3, 4, 8, 16, 32].map(nearestTier)).toEqual([4, 2, 2, 2, 4, 8, 8, 8]);
  });

  it("没开过钟时“继续”按“普通”；在港时跟着后端记下的出港后的一档", () => {
    installIpc();
    startedGame();
    useGame.setState({ runSpeed: 4 });
    act(() => useGame.getState().setOverview({ ...overview, speed: 0, port_hold: HOLD }));
    expect(useGame.getState().runSpeed).toBe(8);
    act(() => useGame.getState().setOverview({ ...overview, speed: 2, port_hold: null }));
    expect(useGame.getState().runSpeed).toBe(2);
  });
});

describe("倍速快捷键", () => {
  it("1 / 2 / 3 切到慢 / 普通 / 快；输入框里打字、按着 Ctrl、按住不放、对话框开着时不理会", async () => {
    const calls = installIpc();
    startedGame();
    render(<TopBar />);
    await screen.findByRole("group", { name: "游戏速度" });
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "3" });
    fireEvent.keyDown(window, { key: "2" });
    await waitFor(() => expect(speedsOf(calls)).toEqual([2, 8, 4]));
    // 存档名输入框里打字
    fireEvent.keyDown(screen.getByLabelText(t("saveSlot")), { key: "1" });
    fireEvent.keyDown(window, { key: "3", ctrlKey: true });
    fireEvent.keyDown(window, { key: "3", repeat: true });
    fireEvent.keyDown(window, { key: "4" });
    // 模态对话框开着（剧情、海战、确认框……）
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("data-test-modal", "");
    document.body.appendChild(dialog);
    fireEvent.keyDown(window, { key: "1" });
    dialog.remove();
    expect(speedsOf(calls)).toEqual([2, 8, 4]);
  });
});

describe("在港暂停", () => {
  it("旗舰队在港：倍速整组变灰、写明原因，出港后的一档描虚线；点“在港 · 去旅店”打开旅店页；出港后恢复", async () => {
    const calls = installIpc();
    startedGame();
    act(() => useGame.getState().setOverview({ ...overview, speed: 0, port_hold: HOLD }));
    const user = userEvent.setup();
    render(<TopBar />);
    const group = await screen.findByRole("group", { name: "游戏速度" });
    for (const name of ["暂停", "慢", "普通", "快", "下一天"]) expect(within(group).getByRole("button", { name })).toBeDisabled();
    expect(within(group).getByRole("button", { name: "快" })).toHaveClass("is-next");
    const why = "旗舰队在港，时间停着：到旅店休息才过天；出港后按「快」继续。";
    expect(group).toHaveAccessibleDescription(why);
    const note = within(group).getByTestId("speed-held");
    expect(note).toHaveTextContent("在港 · 去旅店");
    expect(note).toHaveAttribute("title", why);
    // 变灰的键点了也不发命令
    await user.click(within(group).getByRole("button", { name: "普通" }));
    expect(speedsOf(calls)).toEqual([]);
    await user.click(note);
    expect(useGame.getState().facility).toBe("inn");
    expect(useGame.getState().selectedLoc).toBe(0);
    expect(useShell.getState().windowOpen).toBe(true);
    // 键盘照样记下出港后的一档（后端不走、不报错）
    fireEvent.keyDown(window, { key: "1" });
    await waitFor(() => expect(speedsOf(calls)).toEqual([2]));
    // 出港了：恢复可按，没有“在港”
    act(() => useGame.getState().setOverview({ ...overview, speed: 8, port_hold: null }));
    expect(within(group).getByRole("button", { name: "快" })).toBeEnabled();
    expect(within(group).getByRole("button", { name: "快" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).queryByTestId("speed-held")).toBeNull();
  });
});

/** 打开旗舰队所在港口（澄港）的旅店页；step 默认每次过一天、仍在港。 */
function openInn(step?: (args: Record<string, unknown>) => unknown, hold: PortHoldView = { ...HOLD, resume: 4 }) {
  let day = overview.day;
  const calls = installIpc({
    step:
      step ??
      ((args) => {
        day += Number(args.days);
        return { ...overview, day, port_hold: hold } satisfies Overview;
      }),
  });
  startedGame();
  useGame.setState({ facility: "inn", selectedLoc: 0 });
  act(() => useGame.getState().setOverview({ ...overview, speed: 0, port_hold: hold }));
  render(<PortPanel />);
  return calls;
}

describe("旅店", () => {
  it("只在旗舰队停着的港口出现，排在酒馆后面；休息 3 天：一天一天地推进，完了说一句", async () => {
    const calls = openInn();
    const user = userEvent.setup();
    const tabs = (await screen.findAllByRole("tab")).map((b) => b.textContent);
    expect(tabs.indexOf("旅店")).toBe(tabs.indexOf("酒馆") + 1);
    const inn = await screen.findByTestId("inn");
    for (const name of ["休息 1 天", "休息 3 天", "休息 7 天", "住到下月初（18 天）"]) expect(within(inn).getByRole("button", { name })).toBeEnabled();
    expect(inn).toHaveTextContent("出港后按「普通」继续。");
    await user.click(within(inn).getByRole("button", { name: "休息 3 天" }));
    await waitFor(() => expect(screen.getByTestId("inn-result")).toHaveTextContent("休息了 3 天。"));
    expect(stepsOf(calls)).toEqual([{ days: 1 }, { days: 1 }, { days: 1 }]);
    expect(useGame.getState().overview?.day).toBe(overview.day + 3);
    expect(speedsOf(calls)).toEqual([]);
  });

  it("住到下月初：按概览给的天数；一周以内一天一次，长的几天一次（少传几份概览）", async () => {
    const calls = openInn(undefined, { ...HOLD, month_days: 4 });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "住到下月初（4 天）" }));
    await waitFor(() => expect(screen.getByTestId("inn-result")).toHaveTextContent("休息了 4 天。"));
    expect(stepsOf(calls)).toHaveLength(4);
    cleanup();

    const month = openInn(undefined, { ...HOLD, month_days: 30 });
    await userEvent.setup().click(await screen.findByRole("button", { name: "住到下月初（30 天）" }));
    await waitFor(() => expect(screen.getByTestId("inn-result")).toHaveTextContent("休息了 30 天。"));
    expect(stepsOf(month).map((a) => a.days)).toEqual([4, 4, 4, 4, 4, 4, 4, 2]);
    expect(useGame.getState().overview?.day).toBe(overview.day + 30);
  });

  it("几天一次推进时在哪天停下，就说第几天", async () => {
    let day = overview.day;
    openInn(
      (args) => {
        // 这一次本来要过 4 天，过到第 2 天就有剧情
        const want = Number(args.days);
        const got = day + want >= overview.day + 6 ? 2 : want;
        day += got;
        return { ...overview, day, port_hold: HOLD, awaiting: got < want ? "story" : null };
      },
      { ...HOLD, month_days: 30 },
    );
    await userEvent.setup().click(await screen.findByRole("button", { name: "住到下月初（30 天）" }));
    await waitFor(() => expect(screen.getByTestId("inn-result")).toHaveTextContent("第 6 天有剧情找你，先起来了。"));
  });

  it("休息中显示第几天、可以中途起床", async () => {
    let day = overview.day;
    const slow: { release: (() => void) | null } = { release: null };
    const calls = openInn(() => {
      day += 1;
      const o = { ...overview, day, port_hold: HOLD };
      // 第二天的结算慢一点：这时按“起床”
      return day === overview.day + 2 ? new Promise((r) => (slow.release = () => r(o))) : o;
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "休息 7 天" }));
    const progress = await screen.findByTestId("inn-progress");
    await waitFor(() => expect(progress).toHaveTextContent("休息中：第 2 / 7 天"));
    expect(within(screen.getByTestId("inn")).getByRole("button", { name: "休息 1 天" })).toBeDisabled();
    expect(within(progress).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    await user.click(within(progress).getByRole("button", { name: "起床" }));
    await waitFor(() => expect(slow.release).not.toBeNull());
    act(() => slow.release?.());
    await waitFor(() => expect(screen.getByTestId("inn-result")).toHaveTextContent("休息了 2 天，提前起来了。"));
    expect(stepsOf(calls)).toHaveLength(2);
    expect(screen.queryByTestId("inn-progress")).toBeNull();
  });

  it("遇到要回应的事提前起来，写明第几天、为什么；还没睡下就有事在等时直说", async () => {
    let day = overview.day;
    const calls = openInn(() => {
      day += 1;
      return { ...overview, day, port_hold: HOLD, awaiting: day === overview.day + 2 ? "battle" : null };
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "休息 7 天" }));
    await waitFor(() => expect(screen.getByTestId("inn-result")).toHaveTextContent("第 2 天遇上了海战，先起来了。"));
    expect(stepsOf(calls)).toHaveLength(2);
    cleanup();

    // 剧情在等着、一天也过不去：不空转
    const stuck = openInn(() => ({ ...overview, port_hold: HOLD, awaiting: "story" }));
    await userEvent.setup().click(await screen.findByRole("button", { name: "休息 3 天" }));
    await waitFor(() => expect(screen.getByTestId("inn-result")).toHaveTextContent("有剧情找你，先去处理吧。"));
    expect(stepsOf(stuck)).toHaveLength(1);
  });

  it("不在港（经典世界、旗舰队在海上）时没有旅店；停在旅店页时落回交易所", async () => {
    installIpc();
    startedGame();
    useGame.setState({ facility: "inn", selectedLoc: 0 });
    act(() => useGame.getState().setOverview({ ...overview, port_hold: null }));
    render(<PortPanel />);
    const tabs = (await screen.findAllByRole("tab")).map((b) => b.textContent);
    expect(tabs).not.toContain("旅店");
    expect(screen.queryByTestId("inn")).toBeNull();
    expect(screen.getByRole("tab", { name: tk("port.market") })).toHaveAttribute("aria-selected", "true");
  });
});
