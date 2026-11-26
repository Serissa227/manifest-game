// 航海图的昼夜与天气（EXPANSION.md §9.3）：图例说明天况标记与夜间灯火（旧后端不列）；
// 夜色浓度按时钟、速度（防闪烁）与“昼夜光影”偏好交给渲染器（PixiJS 渲染器以桩代替）。
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MapView from "../components/MapView";
import type { Overview } from "../ipc/types";
import { createMapRenderer } from "../map/renderer";
import { useGame } from "../store/game";
import { useDaylightPref } from "../time/prefs";
import { installIpc, overview, startedGame } from "./fixtures";

vi.mock("../map/renderer", () => ({ createMapRenderer: vi.fn() }));
const create = vi.mocked(createMapRenderer);

const weather: Overview["weather"] = [{ region: 0, sky: "storm", wind_dir: 2, wind_strength: 7 }];

function setOverview(patch: Partial<Overview>) {
  act(() => useGame.getState().setOverview({ ...overview, ...patch }));
}

describe("航海图的图例：天况标记与夜间灯火", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
    create.mockReset();
    create.mockReturnValue(new Promise(() => {}));
  });

  it("旧后端（没有 weather 与 minute）：图例照旧，不列天况与灯火", () => {
    render(<MapView />);
    const legend = screen.getByRole("list", { name: "图例" });
    expect(within(legend).getByText("风向")).toBeInTheDocument();
    expect(legend.querySelectorAll("li.lg-sky")).toHaveLength(0);
    expect(within(legend).queryByText("暴风雨")).toBeNull();
    expect(within(legend).queryByText("夜间灯火")).toBeNull();
  });

  it("后端给出各海区天况与时刻时，图例说明云团、雨、雾、暴风雨、雪与夜间灯火", () => {
    useGame.setState({ overview: { ...overview, minute: 1300, weather } });
    render(<MapView />);
    const legend = screen.getByRole("list", { name: "图例" });
    for (const name of ["多云", "雨", "雾", "暴风雨", "雪"]) {
      expect(within(legend).getByText(name)).toHaveAttribute("title", "各海区当天的天况（随风向漂移）");
    }
    expect(within(legend).getByText("夜间灯火")).toBeInTheDocument();
    expect(legend.querySelectorAll("li.lg-sky")).toHaveLength(5);
    // 原有的图例项不受影响
    expect(within(legend).getByText("风向")).toBeInTheDocument();
    expect(within(legend).getByText("港口")).toBeInTheDocument();
  });
});

describe("航海图的夜色", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
    create.mockReset();
    useDaylightPref.setState({ pref: "clock" });
  });

  it("渲染器就绪后按时钟给出夜色浓度；4× 及以上或“始终白天”时为 0；时刻变化时更新", async () => {
    const setNight = vi.fn();
    create.mockResolvedValue({ update: vi.fn(), setFog: vi.fn(), destroy: vi.fn(), setNight });
    useGame.setState({ overview: { ...overview, minute: 1320, speed: 1 } });
    render(<MapView />);
    await waitFor(() => expect(setNight).toHaveBeenLastCalledWith(1));

    // 次日正午：没有夜色（运行中时钟只前进，22:00 之后的正午在下一天）
    setOverview({ day: overview.day + 1, minute: 720, speed: 1 });
    await waitFor(() => expect(setNight).toHaveBeenLastCalledWith(0));

    // 黄昏 18:00：一半
    setOverview({ day: overview.day + 1, minute: 1080, speed: 1 });
    await waitFor(() => expect(setNight).toHaveBeenLastCalledWith(0.5));

    // 夜里但 8×（一天 0.5 秒）：防闪烁，固定白天
    setOverview({ day: overview.day + 1, minute: 1320, speed: 8 });
    await waitFor(() => expect(setNight).toHaveBeenLastCalledWith(0));

    // 暂停时跟随时钟
    setOverview({ day: overview.day + 1, minute: 1320, speed: 0 });
    await waitFor(() => expect(setNight).toHaveBeenLastCalledWith(1));

    // 偏好“始终白天”
    act(() => useDaylightPref.getState().setPref("day"));
    await waitFor(() => expect(setNight).toHaveBeenLastCalledWith(0));
    act(() => useDaylightPref.getState().setPref("clock"));
    await waitFor(() => expect(setNight).toHaveBeenLastCalledWith(1));
  });

  it("旧后端没有 minute 时按 8:00（白天）；渲染器没有 setNight 时也不出错", async () => {
    const setNight = vi.fn();
    create.mockResolvedValue({ update: vi.fn(), setFog: vi.fn(), destroy: vi.fn(), setNight });
    const { unmount } = render(<MapView />);
    await waitFor(() => expect(setNight).toHaveBeenCalled());
    expect(setNight).toHaveBeenLastCalledWith(0);
    unmount();

    const update = vi.fn();
    create.mockResolvedValue({ update, setFog: vi.fn(), destroy: vi.fn() });
    // 2026-11-13 TCLEANF：P14a（7d8957d4）起航海图看不见时不把概览推给渲染器；夹具里船停在港、舞台是街景，改成舞台是航海图
    useGame.setState({ overview: { ...overview, minute: 1320 }, stage: "chart" });
    render(<MapView />);
    await waitFor(() => expect(update).toHaveBeenCalled());
    setOverview({ minute: 100 });
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ minute: 100 }), 0));
  });
});
