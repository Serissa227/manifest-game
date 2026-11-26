// 天气特效：旗舰队在暴风雨里时整个海图视口出现全画面的雨幕、压暗与闪电，
// 驶出后淡出；下雨轻一些、不闪电；停泊在港与养成期不加；系统要求减少动态效果时静止、不闪电；“天气特效”关掉时不画；
// 航行视图盖着世界图时只画航行视图里那一份；开关与减少动态效果交给航海图的渲染器（PixiJS 渲染器以桩代替；jsdom 没有 2D 画布，
// 画布不画，效果的选择与 DOM 照常）。
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MapView from "../components/MapView";
import SettingsPanel from "../components/panels/SettingsPanel";
import WeatherScreen, { SCREEN_FADE_MS } from "../components/WeatherScreen";
import { resetNav, useNavStore } from "../hooks/useNavigation";
import type { LocalWeatherView, NavView, Overview, SkyKind, StaticView } from "../ipc/types";
import { createMapRenderer } from "../map/renderer";
import { useWeatherFxPref } from "../map/weatherPref";
import { useGame } from "../store/game";
import { installIpc, overview, startedGame, statics } from "./fixtures";

vi.mock("../map/renderer", () => ({ createMapRenderer: vi.fn() }));
const create = vi.mocked(createMapRenderer);

const local = (sky: SkyKind): LocalWeatherView => ({ region: 0, region_name: "内海", sky, wind_dir: 2, wind_strength: 7, forecast: [] });

/** 旗舰队在海上、所在海区当天是 sky。 */
const atSea = (sky: SkyKind, patch: Partial<Overview> = {}): Overview => ({
  ...overview,
  fleets: [{ ...overview.fleets[0], docked: null, dest: 0, x: 3, y: 2, path: [[3, 2]], days_at_sea: 2 }],
  weather: [{ region: 0, sky, wind_dir: 2, wind_strength: 7 }],
  local_weather: local(sky),
  speed: 1,
  ...patch,
});

function setOverview(o: Overview) {
  act(() => useGame.getState().setOverview(o));
}

/** 系统的“减少动态效果”：jsdom 没有 matchMedia，这里补一个。 */
function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) => ({
      matches: reduce && q.includes("prefers-reduced-motion"),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    })),
  );
}

beforeEach(() => {
  installIpc();
  startedGame();
  useGame.setState({ stage: "chart", overview: atSea("clear") });
  useWeatherFxPref.setState({ on: true });
  resetNav();
  create.mockReset();
  create.mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useWeatherFxPref.setState({ on: true });
  resetNav();
});

describe("全画面天气：旗舰队所在处", () => {
  it("旗舰在暴风雨里：整个海图视口出现雨幕、压暗与闪电，不挡点选；晴天没有", () => {
    useGame.setState({ overview: atSea("storm") });
    render(<MapView />);
    const fx = screen.getByTestId("weather-screen");
    expect(fx).toHaveAttribute("data-sky", "storm");
    expect(fx).toHaveAttribute("data-lightning", "on");
    expect(fx).toHaveAttribute("data-motion", "live");
    expect(fx).toHaveAttribute("data-state", "in");
    expect(fx).toHaveAttribute("aria-hidden", "true");
    // 在航海图里（海图画布之上，左侧栏在它后面的兄弟位置，样式里 z-index 更高）
    expect(screen.getByTestId("map-container")).toContainElement(fx);
    expect(within(fx).getByTestId("weather-screen-base").tagName).toBe("CANVAS");
    // 晴天：没有全画面效果
    setOverview(atSea("clear", { day: overview.day + 1 }));
    expect(screen.getByTestId("weather-screen")).toHaveAttribute("data-state", "out");
  });

  it("驶出暴风雨后淡出、随后消失；下雨轻一些、不闪电；多云没有", () => {
    vi.useFakeTimers();
    useGame.setState({ overview: atSea("storm") });
    render(<WeatherScreen layer="chart" />);
    expect(screen.getByTestId("weather-screen")).toHaveAttribute("data-sky", "storm");
    // 驶进下雨的海区：换成雨，不闪电
    setOverview(atSea("rain", { day: overview.day + 1 }));
    expect(screen.getByTestId("weather-screen")).toHaveAttribute("data-sky", "rain");
    expect(screen.getByTestId("weather-screen")).toHaveAttribute("data-lightning", "off");
    // 驶出到多云的海区：先淡出（还在，状态为 out），淡出的时长过后消失
    setOverview(atSea("cloudy", { day: overview.day + 2 }));
    const leaving = screen.getByTestId("weather-screen");
    expect(leaving).toHaveAttribute("data-state", "out");
    expect(leaving).toHaveAttribute("data-sky", "rain");
    act(() => vi.advanceTimersByTime(SCREEN_FADE_MS + 10));
    expect(screen.queryByTestId("weather-screen")).toBeNull();
    // 再驶进暴风雨：又出现
    setOverview(atSea("storm", { day: overview.day + 3 }));
    expect(screen.getByTestId("weather-screen")).toHaveAttribute("data-state", "in");
  });

  it("停泊在港（港口画面）、没有舰队、养成期不加；起雾、下雪各有一层", () => {
    useGame.setState({ overview: { ...overview, weather: [{ region: 0, sky: "storm", wind_dir: 2, wind_strength: 7 }], local_weather: local("storm") } });
    const { unmount } = render(<WeatherScreen layer="chart" />);
    expect(screen.queryByTestId("weather-screen")).toBeNull();
    setOverview(atSea("storm", { fleets: [] }));
    expect(screen.queryByTestId("weather-screen")).toBeNull();
    setOverview(atSea("storm", { mode: "upbringing" }));
    expect(screen.queryByTestId("weather-screen")).toBeNull();
    unmount();
    for (const sky of ["fog", "snow"] as const) {
      useGame.setState({ overview: atSea(sky) });
      const r = render(<WeatherScreen layer="chart" />);
      expect(screen.getByTestId("weather-screen")).toHaveAttribute("data-sky", sky);
      expect(screen.getByTestId("weather-screen")).toHaveAttribute("data-lightning", "off");
      r.unmount();
    }
  });

  it("4× 及以上不闪电（防闪烁，与航行小画面同一规则）；暂停时照常", () => {
    useGame.setState({ overview: atSea("storm", { speed: 8 }) });
    render(<WeatherScreen layer="chart" />);
    expect(screen.getByTestId("weather-screen")).toHaveAttribute("data-lightning", "off");
    setOverview(atSea("storm", { speed: 0 }));
    expect(screen.getByTestId("weather-screen")).toHaveAttribute("data-lightning", "on");
  });

  it("系统要求减少动态效果：只留静止的压暗与雨线纹理，不闪电，离开时立即收起", () => {
    stubReducedMotion(true);
    useGame.setState({ overview: atSea("storm") });
    render(<WeatherScreen layer="chart" />);
    const fx = screen.getByTestId("weather-screen");
    expect(fx).toHaveAttribute("data-motion", "still");
    expect(fx).toHaveAttribute("data-lightning", "off");
    expect(fx).toHaveAttribute("data-sky", "storm");
    setOverview(atSea("clear", { day: overview.day + 1 }));
    expect(screen.queryByTestId("weather-screen")).toBeNull();
  });

  it("“天气特效”关掉时不画（打开后又出现）", () => {
    useWeatherFxPref.setState({ on: false });
    useGame.setState({ overview: atSea("storm") });
    render(<WeatherScreen layer="chart" />);
    expect(screen.queryByTestId("weather-screen")).toBeNull();
    act(() => useWeatherFxPref.setState({ on: true }));
    expect(screen.getByTestId("weather-screen")).toHaveAttribute("data-sky", "storm");
    act(() => useWeatherFxPref.setState({ on: false }));
    expect(screen.queryByTestId("weather-screen")).toBeNull();
  });
});

describe("全画面天气：手动航行", () => {
  const manual: StaticView = { ...statics, world: { ...statics.world, modules: ["navigation_manual"] } };
  const NAV: NavView = {
    fleet: 0,
    mode: "manual",
    day: 12,
    minute: 0,
    pos: { x: 1.5, y: 1.25 },
    heading: 90,
    sail: "full",
    speed: 6,
    wind: { dir: 270, force: 8, name: "西风 8 级" },
    current: null,
    sail_limit: 67,
    trail: [],
    forecast: [],
    stops: [],
    supplies_days: 9,
    morale: 70,
    sight: 6,
    autopilot: null,
    known_dests: [],
    lat_lon: null,
  };

  it("航行视图里画一份（仪表之下），盖着的世界图那一份不画；切到世界图时换世界图那一份", async () => {
    installIpc({ navigation: () => NAV, preview_course: () => ({ points: [[1.5, 1.25, 0]], stops: [] }) });
    const o = atSea("storm", { fleets: [{ ...atSea("storm").fleets[0], pos: { x: 1.5, y: 1.25 }, heading: 90 }] });
    useGame.setState({ statics: manual, overview: o, stage: "chart" });
    create.mockResolvedValue({ update: vi.fn(), setFog: vi.fn(), destroy: vi.fn() });
    render(<MapView />);
    const view = await screen.findByTestId("nav-view");
    await screen.findByTestId("nav-hud");
    const all = screen.getAllByTestId("weather-screen");
    expect(all).toHaveLength(1);
    expect(all[0]).toHaveAttribute("data-layer", "nav");
    expect(view).toContainElement(all[0]);
    // 切到世界图
    act(() => useNavStore.setState({ view: "world" }));
    await waitFor(() => expect(screen.getByTestId("weather-screen")).toHaveAttribute("data-layer", "chart"));
    expect(screen.getAllByTestId("weather-screen")).toHaveLength(1);
  });
});

describe("航海图上按海区的天气：开关交给渲染器", () => {
  it("渲染器就绪后给出开关；旗舰在暴风雨里时海图不另闪（跟着全画面一起亮）；关掉“天气特效”与减少动态效果都告诉它", async () => {
    const setWeatherFx = vi.fn();
    create.mockResolvedValue({ update: vi.fn(), setFog: vi.fn(), destroy: vi.fn(), setWeatherFx });
    useGame.setState({ overview: atSea("rain") });
    render(<MapView />);
    await waitFor(() => expect(setWeatherFx).toHaveBeenLastCalledWith({ enabled: true, reduced: false, lightning: true }));
    setOverview(atSea("storm", { day: overview.day + 1 }));
    await waitFor(() => expect(setWeatherFx).toHaveBeenLastCalledWith({ enabled: true, reduced: false, lightning: false }));
    act(() => useWeatherFxPref.getState().setOn(false));
    await waitFor(() => expect(setWeatherFx).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false })));
    expect(localStorage.getItem("manifest.weatherFx")).toBe("off");
    act(() => useWeatherFxPref.getState().setOn(true));
    await waitFor(() => expect(setWeatherFx).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true })));
    expect(localStorage.getItem("manifest.weatherFx")).toBe("on");
  });

  it("减少动态效果时告诉渲染器（静止、不闪电）；渲染器没有 setWeatherFx（旧桩）时也不出错", async () => {
    stubReducedMotion(true);
    const setWeatherFx = vi.fn();
    create.mockResolvedValue({ update: vi.fn(), setFog: vi.fn(), destroy: vi.fn(), setWeatherFx });
    const { unmount } = render(<MapView />);
    await waitFor(() => expect(setWeatherFx).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true, reduced: true })));
    unmount();
    const update = vi.fn();
    create.mockResolvedValue({ update, setFog: vi.fn(), destroy: vi.fn() });
    render(<MapView />);
    await waitFor(() => expect(update).toHaveBeenCalled());
  });
});

describe("设置：天气特效的开关", () => {
  it("在“画面”一节里，缺省开着；勾掉后保存在本机、立即生效，不发命令", async () => {
    const calls = installIpc();
    localStorage.removeItem("manifest.weatherFx");
    const user = userEvent.setup();
    render(<SettingsPanel />);
    const box = await screen.findByLabelText("天气特效");
    expect(screen.getByTestId("settings-display")).toContainElement(box);
    expect(box).toBeChecked();
    await user.click(box);
    expect(useWeatherFxPref.getState().on).toBe(false);
    expect(localStorage.getItem("manifest.weatherFx")).toBe("off");
    expect(box).not.toBeChecked();
    expect(calls.mock.calls.some(([c]) => c === "save_settings" || c === "submit")).toBe(false);
    await user.click(box);
    expect(useWeatherFxPref.getState().on).toBe(true);
  });
});
