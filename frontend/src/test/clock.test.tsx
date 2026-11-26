// 时钟数据流与速度按钮（EXPANSION.md §9.2）：6 档倍速、clock 事件更新 useClock、概览的 minute 同步到时钟、
// 迟到的旧推送不让时钟倒退、独立的时钟 store 不牵动主 store。
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emit } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it } from "vitest";
import App from "../App";
import SettingsPanel from "../components/panels/SettingsPanel";
import { useShell } from "../components/shell/shellState";
import { useClock, useScenePhase } from "../hooks/useClock";
import { onClock } from "../ipc/api";
import type { Overview } from "../ipc/types";
import { clockStamp, useClockStore } from "../store/clock";
import { useGame } from "../store/game";
import { useDaylightPref } from "../time/prefs";
import { installIpc, overview, startedGame } from "./fixtures";

/** 显示 useClock 与 useScenePhase 的探针组件。 */
function Probe() {
  const { day, minute } = useClock();
  const phase = useScenePhase();
  return (
    <p data-testid="probe">
      {day}/{minute}/{phase}
    </p>
  );
}

function probe() {
  return screen.getByTestId("probe").textContent;
}

function setOverview(patch: Partial<Overview>) {
  act(() => useGame.getState().setOverview({ ...overview, ...patch }));
}

describe("速度按钮", () => {
  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    calls = installIpc();
    startedGame();
    useShell.setState({ windowOpen: false });
  });

  // 11-03 起顶栏只给慢 / 普通 / 快三档（原来是 1× … 32× 六档，见 docs/DECISIONS.md 2026-11-03）
  it("顶栏有三档倍速（慢 / 普通 / 快 = 2× / 4× / 8×），点击调用 set_speed，当前速度高亮", async () => {
    const user = userEvent.setup();
    render(<App />);
    const group = await screen.findByRole("group", { name: "游戏速度" });
    const names = within(group)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(names.filter((n) => n === "慢" || n === "普通" || n === "快")).toEqual(["慢", "普通", "快"]);
    // 暂停 + 3 档 + 下一天
    expect(within(group).getAllByRole("button")).toHaveLength(5);
    for (const [name, n] of [
      ["快", 8],
      ["慢", 2],
      ["普通", 4],
    ] as const) {
      await user.click(within(group).getByRole("button", { name }));
      await waitFor(() => expect(calls).toHaveBeenCalledWith("set_speed", { speed: n }));
    }
    // 悬停提示每档一天的实时长度与快捷键
    // 2026-11-13 TCLEANF：H10F（c94f1e61）起提示写“一天约 N 秒”，原来是“每天 N 秒”
    expect(within(group).getByRole("button", { name: "慢" })).toHaveAttribute("title", "慢：一天约 2 秒（键盘 1）");
    expect(within(group).getByRole("button", { name: "普通" })).toHaveAttribute("title", "普通：一天约 1 秒（键盘 2）");
    expect(within(group).getByRole("button", { name: "快" })).toHaveAttribute("title", "快：一天约 0.5 秒（键盘 3）");
    // 高亮跟随概览的速度；旧的倍速按最近的一档亮
    setOverview({ speed: 8 });
    expect(within(group).getByRole("button", { name: "快" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "普通" })).toHaveAttribute("aria-pressed", "false");
    setOverview({ speed: 32 });
    expect(within(group).getByRole("button", { name: "快" })).toHaveAttribute("aria-pressed", "true");
    setOverview({ speed: 1 });
    expect(within(group).getByRole("button", { name: "慢" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "暂停" })).toHaveAttribute("aria-pressed", "false");
    await user.click(within(group).getByRole("button", { name: "暂停" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("set_speed", { speed: 0 }));
    // “下一天”推进一天（到下一个 6:00）
    await user.click(within(group).getByRole("button", { name: "下一天" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("step", { days: 1 }));
  });

  it("设置里的默认速度同样是三档；旧设置里的倍速显示为最近的一档", async () => {
    render(<SettingsPanel />);
    const select = await screen.findByLabelText("默认速度");
    const options = within(select)
      .getAllByRole("option")
      .map((o) => o.textContent);
    // 2026-11-13 TCLEANF：H10F（c94f1e61）起设置里的选项写明港内与海上的日长，原来是“每天 N 秒”
    expect(options).toEqual(["慢（港内一天 2 秒，海上 6 秒）", "普通（港内一天 1 秒，海上 3 秒）", "快（港内一天 0.5 秒，海上 1 秒）"]);
    // 夹具的设置是旧的 1×：显示为“慢”
    expect(select).toHaveValue("2");
  });
});

describe("时钟数据流", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
    useShell.setState({ windowOpen: false });
    useDaylightPref.setState({ pref: "clock" });
  });

  it("clock 事件更新 useClock；概览的 minute 同步到时钟", async () => {
    render(
      <>
        <App />
        <Probe />
      </>,
    );
    await screen.findByRole("group", { name: "游戏速度" });
    // 夹具概览没有 minute（旧后端）：取 8:00
    expect(probe()).toBe("12/480/day");

    // 后端的 clock 事件
    await act(() => emit("clock", { day: 12, minute: 1320 }));
    await waitFor(() => expect(probe()).toBe("12/1320/night"));
    // 午夜之后仍是同一天（游戏日从 6:00 开始）
    await act(() => emit("clock", { day: 12, minute: 240 }));
    await waitFor(() => expect(probe()).toBe("12/240/night"));
    await act(() => emit("clock", { day: 13, minute: 400 }));
    await waitFor(() => expect(probe()).toBe("13/400/dawn"));

    // 每日 tick 推送的概览带 minute：以概览为准
    await act(() => emit("tick", { ...overview, day: 14, date: 15, minute: 365 }));
    await waitFor(() => expect(probe()).toBe("14/365/dawn"));
    // 命令返回的概览（例如设置速度）同样同步
    setOverview({ day: 14, minute: 900 });
    expect(probe()).toBe("14/900/day");
    // 4× 及以上光照固定为白天（防闪烁），时钟照走
    setOverview({ day: 14, minute: 1300, speed: 4 });
    expect(probe()).toBe("14/1300/day");
  });

  it("迟到的旧推送不让时钟倒退；暂停时以概览为准（开局、读档可以倒退）", async () => {
    render(
      <>
        <App />
        <Probe />
      </>,
    );
    await screen.findByRole("group", { name: "游戏速度" });
    setOverview({ day: 20, minute: 600, speed: 1 });
    await act(() => emit("clock", { day: 20, minute: 700 }));
    await waitFor(() => expect(probe()).toBe("20/700/day"));
    // 比当前时钟旧的 clock 事件：忽略
    await act(() => emit("clock", { day: 20, minute: 650 }));
    await act(() => emit("clock", { day: 19, minute: 1000 }));
    expect(probe()).toBe("20/700/day");
    // 运行中迟到的命令返回（概览比 clock 事件旧）：不把时钟拨回去
    setOverview({ day: 20, minute: 640, speed: 1, cash: 1 });
    expect(probe()).toBe("20/700/day");
    expect(useGame.getState().overview?.cash).toBe(1);
    // 暂停：概览带着暂停时的准确时刻，以它为准
    setOverview({ day: 20, minute: 705, speed: 0 });
    expect(probe()).toBe("20/705/day");
    // 读了更早的存档（暂停）：时钟倒退到存档的时刻
    setOverview({ day: 3, minute: 1200, speed: 0 });
    expect(probe()).toBe("3/1200/night");
    // 回到主菜单：时钟回到第 0 天 8:00
    act(() => useGame.getState().leave());
    expect(useClockStore.getState()).toMatchObject({ day: 0, minute: 480 });
  });

  it("clock 事件只更新时钟 store，不改动主 store", async () => {
    render(<App />);
    await screen.findByRole("group", { name: "游戏速度" });
    const before = useGame.getState();
    await act(() => emit("clock", { day: 12, minute: 900 }));
    await waitFor(() => expect(useClockStore.getState().minute).toBe(900));
    const after = useGame.getState();
    expect(after.overview).toBe(before.overview);
    expect(after.version).toBe(before.version);
  });

  it("onClock 订阅与取消订阅；非法负载被忽略", async () => {
    const got: number[] = [];
    const un = await onClock((c) => {
      got.push(c.minute);
      useClockStore.getState().applyClock(c);
    });
    await emit("clock", { day: 12, minute: 1000 });
    expect(got).toEqual([1000]);
    expect(useClockStore.getState()).toMatchObject({ day: 12, minute: 1000 });
    un();
    await emit("clock", { day: 12, minute: 1100 });
    expect(got).toEqual([1000]);
    // 非法负载
    const s = useClockStore.getState();
    s.applyClock({ day: Number.NaN, minute: 1200 });
    s.applyClock({ day: 13, minute: Number.POSITIVE_INFINITY });
    s.applyClock(null as unknown as { day: number; minute: number });
    expect(useClockStore.getState()).toMatchObject({ day: 12, minute: 1000 });
    // 越界的分钟规范到 0–1439
    s.applyClock({ day: 13, minute: 1440 + 400 });
    expect(useClockStore.getState()).toMatchObject({ day: 13, minute: 400 });
  });

  it("时刻戳：先比日期，再比从 6:00 起走过的分钟", () => {
    expect(clockStamp(3, 360)).toBe(3 * 1440);
    expect(clockStamp(3, 120)).toBeGreaterThan(clockStamp(3, 1380));
    expect(clockStamp(4, 360)).toBeGreaterThan(clockStamp(3, 359));
  });
});
