// 测试 13：地图容器（模拟的 Tauri IPC；PixiJS 渲染器以桩代替）。
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MapView from "../components/MapView";
import { createMapRenderer } from "../map/renderer";
import { useGame } from "../store/game";
import { installIpc, overview, startedGame, statics } from "./fixtures";

vi.mock("../map/renderer", () => ({ createMapRenderer: vi.fn() }));
const create = vi.mocked(createMapRenderer);

describe("地图容器", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
    create.mockReset();
  });

  it("创建渲染器并随概览与选择更新", async () => {
    const update = vi.fn();
    const destroy = vi.fn();
    const setFog = vi.fn();
    create.mockResolvedValue({ update, destroy, setFog });
    // 2026-11-13 TCLEANF：P14a（7d8957d4）起航海图看不见时不把概览推给渲染器；夹具里船停在港、舞台是街景，改成舞台是航海图
    useGame.setState({ stage: "chart" });
    const { unmount } = render(<MapView />);
    const canvas = screen.getByTestId("map-canvas");
    expect(canvas).toBeInTheDocument();
    await waitFor(() => expect(update).toHaveBeenCalledWith(overview, 0));
    expect(create).toHaveBeenCalledWith(canvas, statics, expect.any(Function));
    // 迷雾：渲染器就绪后获取一次，探索进度变化时再获取
    await waitFor(() => expect(setFog).toHaveBeenCalledTimes(1));
    expect(setFog.mock.calls[0][0]).toEqual(["1111", "1111", "1111"]);

    // 地点列表可选择地点，渲染器随之高亮
    await userEvent.click(screen.getByRole("button", { name: /柳湾/ }));
    expect(useGame.getState().selectedLoc).toBe(1);
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(overview, 1));

    // 在地图上点选地点（渲染器回调）会切到港口面板
    useGame.setState({ tab: "reports" });
    const pick = create.mock.calls[0][2];
    pick(2);
    expect(useGame.getState().selectedLoc).toBe(2);
    expect(useGame.getState().tab).toBe("port");

    // 概览更新（后端推送）时重绘；探索进度变化时刷新迷雾
    const next = { ...overview, day: 13, fog_version: 120 };
    useGame.getState().setOverview(next);
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(next, 2));
    await waitFor(() => expect(setFog).toHaveBeenCalledTimes(2));

    unmount();
    expect(destroy).toHaveBeenCalled();
  });

  it("显示图例、港口与城市，停靠舰队的港口带标记", () => {
    create.mockReturnValue(new Promise(() => {}));
    render(<MapView />);
    expect(screen.getByText("港口")).toBeInTheDocument();
    expect(screen.getByText("内陆城市")).toBeInTheDocument();
    expect(screen.getByText("风向")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /澄港 ⛵/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /兰城/ })).toHaveAttribute("title", "内陆城市");
  });

  it("渲染器不可用时提示改用地点列表", async () => {
    create.mockRejectedValue(new Error("no webgl"));
    render(<MapView />);
    expect(await screen.findByText("地图渲染不可用，请使用地点列表。")).toBeInTheDocument();
  });
});
