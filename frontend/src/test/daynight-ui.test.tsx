// 街景、航行小画面与设置里的昼夜与天气（EXPANSION.md §9.3）：当地天况的来源、防闪烁（4× 及以上白天、偏好“始终白天”）、
// 设置里的“昼夜光影”立即生效。概览与静态数据都用 mock，不连后端。
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import PortScene from "../components/PortScene";
import SettingsPanel from "../components/panels/SettingsPanel";
import { sceneWeather, voyageWeather, weatherOfSky, windXOf } from "../components/port/sceneLook";
import VoyageHud from "../components/VoyageHud";
import type { LocalWeatherView, Overview, RegionWeatherView, StaticView } from "../ipc/types";
import { useGame } from "../store/game";
import { useDaylightPref } from "../time/prefs";
import { installIpc, overview, startedGame, statics } from "./fixtures";

/** 两个海区：澄港在 0 区，柳湾在 1 区，兰城是内陆城市（没有海区）。 */
const withRegions: StaticView = {
  ...statics,
  regions: [
    { id: 0, name: "内海" },
    { id: 1, name: "外洋" },
  ],
  locations: statics.locations.map((l) => ({ ...l, region: l.kind === "city" ? null : l.id === 0 ? 0 : 1 })),
};

const WEATHER: RegionWeatherView[] = [
  { region: 0, sky: "cloudy", wind_dir: 2, wind_strength: 3 },
  { region: 1, sky: "snow", wind_dir: 6, wind_strength: 7 },
];

const LOCAL: LocalWeatherView = { region: 0, region_name: "内海", sky: "rain", wind_dir: 5, wind_strength: 6, forecast: [] };

function scene(): HTMLElement {
  return screen.getByTestId("port-scene");
}

function setOverview(patch: Partial<Overview>) {
  act(() => useGame.setState({ overview: { ...overview, ...patch } }));
}

describe("街景的当地天况", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
    useGame.setState({ statics: withRegions });
    useDaylightPref.setState({ pref: "clock" });
  });

  it("旗舰队停泊在此港时用 local_weather，否则按地点的海区查 weather；内陆城市为晴", async () => {
    useGame.setState({ overview: { ...overview, weather: WEATHER, local_weather: LOCAL } });
    render(<PortScene />);
    await screen.findByRole("group", { name: "澄港的设施" });
    // 澄港：旗舰队停在这里 → 当地天气（雨），而不是 0 区的多云
    expect(scene()).toHaveAttribute("data-sky", "rain");
    // 2026-11-13 TCLEANF：FIX4F（22374492）起街景跟着旗舰队停泊的港，改成舰队在海上再点选
    setOverview({ weather: WEATHER, local_weather: LOCAL, fleets: overview.fleets.map((f) => ({ ...f, docked: null })) });
    act(() => useGame.setState({ selectedLoc: 1 }));
    await waitFor(() => expect(scene()).toHaveAttribute("data-sky", "snow"));
    act(() => useGame.setState({ selectedLoc: 2 }));
    await waitFor(() => expect(scene()).toHaveAttribute("data-sky", "clear"));
  });

  it("旧后端没有天气与时刻：降级为白天晴天", async () => {
    render(<PortScene />);
    await screen.findByRole("group", { name: "澄港的设施" });
    expect(scene()).toHaveAttribute("data-sky", "clear");
    expect(scene()).toHaveAttribute("data-phase", "day");
  });

  it("sceneWeather / voyageWeather：来源、风的东西分量、未知天况按晴", () => {
    const ov: Overview = { ...overview, weather: WEATHER, local_weather: LOCAL };
    expect(sceneWeather(withRegions, ov, 0)).toEqual({ sky: "rain", windX: -1, windStrength: 6, source: "local" });
    expect(sceneWeather(withRegions, ov, 1)).toEqual({ sky: "snow", windX: -1, windStrength: 7, source: "region" });
    expect(sceneWeather(withRegions, ov, 2).sky).toBe("clear");
    expect(sceneWeather(withRegions, overview, 0).sky).toBeUndefined();
    expect(sceneWeather(withRegions, null, 0).sky).toBeUndefined();
    // 旗舰队不在此港：即使有 local_weather 也按海区
    const away: Overview = { ...ov, fleets: ov.fleets.map((f) => ({ ...f, docked: null })) };
    expect(sceneWeather(withRegions, away, 0)).toMatchObject({ sky: "cloudy", windX: 1, source: "region" });
    expect(voyageWeather(ov)).toMatchObject({ sky: "rain", source: "local" });
    expect(voyageWeather(overview).sky).toBeUndefined();
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(windXOf)).toEqual([0, 1, 1, 1, 0, -1, -1, -1]);
    expect(windXOf(-1)).toBe(-1);
    expect(weatherOfSky("hail")).toBe("clear");
    expect(weatherOfSky("fog")).toBe("fog");
  });
});

describe("街景的时段与防闪烁", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
    useDaylightPref.setState({ pref: "clock" });
  });

  it("夜里 22:00：暂停与 1×、2× 时为夜晚；4× 及以上固定为白天；偏好“始终白天”时为白天", async () => {
    useGame.setState({ overview: { ...overview, minute: 22 * 60, speed: 0 } });
    render(<PortScene />);
    await screen.findByRole("group", { name: "澄港的设施" });
    expect(scene()).toHaveAttribute("data-phase", "night");
    setOverview({ minute: 22 * 60, speed: 2 });
    expect(scene()).toHaveAttribute("data-phase", "night");
    setOverview({ minute: 22 * 60, speed: 8 });
    expect(scene()).toHaveAttribute("data-phase", "day");
    setOverview({ minute: 22 * 60, speed: 4 });
    expect(scene()).toHaveAttribute("data-phase", "day");
    setOverview({ minute: 22 * 60, speed: 1 });
    expect(scene()).toHaveAttribute("data-phase", "night");
    act(() => useDaylightPref.getState().setPref("day"));
    expect(scene()).toHaveAttribute("data-phase", "day");
  });

  it("黎明、黄昏按时刻切换", async () => {
    useGame.setState({ overview: { ...overview, minute: 5 * 60 + 30, speed: 1 } });
    render(<PortScene />);
    await screen.findByRole("group", { name: "澄港的设施" });
    expect(scene()).toHaveAttribute("data-phase", "dawn");
    // 运行中时钟只前进（游戏日从 6:00 起算）：5:30 之后的 18:00、12:00 分别在下一天、再下一天
    setOverview({ day: overview.day + 1, minute: 18 * 60, speed: 1 });
    expect(scene()).toHaveAttribute("data-phase", "dusk");
    setOverview({ day: overview.day + 2, minute: 12 * 60, speed: 1 });
    expect(scene()).toHaveAttribute("data-phase", "day");
  });
});

describe("航行小画面的时段与天况", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
    useDaylightPref.setState({ pref: "clock" });
  });

  it("旗舰队在海上：小画面取当地天况与时段；4× 及以上为白天", () => {
    const atSea: Overview = {
      ...overview,
      minute: 23 * 60,
      speed: 1,
      local_weather: { ...LOCAL, sky: "storm" },
      fleets: overview.fleets.map((f) => ({ ...f, docked: null, dest: 1, days_at_sea: 2 })),
    };
    useGame.setState({ overview: atSea });
    const { container } = render(<VoyageHud />);
    const canvas = container.querySelector("canvas.voyage-vignette");
    expect(canvas).not.toBeNull();
    expect(canvas).toHaveAttribute("data-sky", "storm");
    expect(canvas).toHaveAttribute("data-phase", "night");
    setOverview({ ...atSea, speed: 16 });
    expect(container.querySelector("canvas.voyage-vignette")).toHaveAttribute("data-phase", "day");
  });
});

describe("设置：昼夜光影", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
    useDaylightPref.setState({ pref: "clock" });
  });
  afterEach(() => {
    useDaylightPref.getState().setPref("clock");
  });

  it("切换“始终白天 / 跟随时间”立即生效并记在本机", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);
    const select = await screen.findByLabelText("昼夜光影");
    expect(select).toHaveValue("clock");
    expect(screen.getByRole("option", { name: "跟随时间" })).toBeInTheDocument();
    await user.selectOptions(select, "day");
    expect(useDaylightPref.getState().pref).toBe("day");
    expect(globalThis.localStorage.getItem("manifest.daylight")).toBe("day");
    await user.selectOptions(select, "clock");
    expect(useDaylightPref.getState().pref).toBe("clock");
    expect(globalThis.localStorage.getItem("manifest.daylight")).toBe("clock");
  });
});
