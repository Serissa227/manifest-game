import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emit } from "@tauri-apps/api/event";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { useGame } from "./store/game";
import { installIpc, overview } from "./test/fixtures";

describe("App", () => {
  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    calls = installIpc();
    useGame.setState({ statics: null, overview: null, version: 0, selectedLoc: null, selectedFleet: null, error: null });
  });

  it("载入静态数据后显示开局界面，开局后进入主界面", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "选择开局剧本" })).toBeInTheDocument();
    expect(screen.getByText("新晋船主")).toBeInTheDocument();
    // 开局向导（测试数据没有身世）：剧本 → 外貌 → 姓名 → 启航，种子在最后一步
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.type(screen.getByLabelText("随机种子（可留空）"), "42");
    await user.click(screen.getByRole("button", { name: "开始新游戏" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("new_game", { scenario: "newcomer", seed: 42 }));
    expect(await screen.findByTestId("cash")).toHaveTextContent("12,345 金币");
    expect(screen.getByTestId("budget")).toHaveTextContent("3/60 次");
    expect(screen.getByTestId("date")).toHaveTextContent("1502年1月13日（春）");
    expect(screen.getByTestId("map-container")).toBeInTheDocument();
    expect(await screen.findByTestId("port-panel")).toBeInTheDocument();

    // 时间控制（11-03 起只有慢 / 普通 / 快三档，“普通”即 4×）
    await user.click(screen.getByRole("button", { name: "普通" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("set_speed", { speed: 4 }));
    await user.click(screen.getByRole("button", { name: "下一天" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("step", { days: 1 }));

    // 后端推送的每日概览
    await act(() => emit("tick", { ...overview, day: 13, date: 14, cash: 999 }));
    await waitFor(() => expect(screen.getByTestId("cash")).toHaveTextContent("999 金币"));
    expect(screen.getByTestId("date")).toHaveTextContent("1502年1月14日");

    // 切换侧栏
    await user.click(screen.getByRole("tab", { name: "舰队" }));
    expect(await screen.findByTestId("fleet-panel")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "情报" }));
    expect(await screen.findByTestId("intel-panel")).toBeInTheDocument();
  });
});

describe("无障碍名称", () => {
  it("速度按钮组、图例与侧栏各有准确的名称，“暂停”只指按钮本身", async () => {
    installIpc();
    const { startedGame } = await import("./test/fixtures");
    startedGame();
    render(<App />);
    expect(await screen.findByRole("group", { name: "游戏速度" })).toBeInTheDocument();
    // 名为“暂停”的只有暂停按钮一个，速度按钮组不再冒用这个名字
    expect(screen.getAllByRole("button", { name: "暂停" })).toHaveLength(1);
    expect(screen.queryByRole("group", { name: "暂停" })).toBeNull();
    expect(screen.queryByRole("list", { name: "风向" })).toBeNull();
    expect(screen.getByRole("list", { name: "图例" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "功能面板" })).toBeInTheDocument();
  });
});
