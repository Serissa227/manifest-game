// 配乐：场景 → 曲目（港口按文化、殖民点、海上按海区的七首航海曲、暴风雨、海盗）、环境声跟天气走、
// 声音偏好的读写，以及顶栏的音乐开关与设置里的“声音”一节。
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { sceneOf, useMusicStatus } from "../audio/director";
import { DEFAULT_PREFS, loadPrefs, useAudioPrefs } from "../audio/prefs";
import { TRACK_IDS } from "../audio/tracks";
import { SoundSection } from "../components/panels/SoundSettings";
import MusicToggle from "../components/shell/MusicToggle";
import type { LocalWeatherView, Overview, PendingView } from "../ipc/types";
import { colonialStatics, overview, statics } from "./fixtures";

const KEY = "manifest.audio";

function atSea(x: number, y: number, extra: Partial<Overview> = {}): Overview {
  return { ...overview, fleets: [{ ...overview.fleets[0], docked: null, x, y }], ...extra };
}

function dockedAt(loc: number): Overview {
  return { ...overview, fleets: [{ ...overview.fleets[0], docked: loc }] };
}

const storm: LocalWeatherView = { sky: "storm", wind_dir: 2, wind_strength: 8, region_name: "", forecast: [] } as unknown as LocalWeatherView;

describe("场景 → 曲目", () => {
  it("还没开局：主题曲，标题画面的环境声", () => {
    expect(sceneOf(false, statics, overview)).toMatchObject({ track: "title", ambience: { place: "title" }, urgent: false });
    expect(sceneOf(true, statics, null).track).toBe("title");
  });

  it("靠港：按港口所属势力的文化放港口曲，港内的环境声", () => {
    // 地点 0 属翠岚（cuilan → 地中海），地点 1 属金穗（jinsui → 低地）
    expect(sceneOf(true, statics, dockedAt(0))).toMatchObject({ track: "port_mediterranean", ambience: { place: "port" } });
    expect(sceneOf(true, statics, dockedAt(1)).track).toBe("port_lowland");
    // 势力数据写了 style 时以它为准
    const eastern = { ...statics, factions: statics.factions.map((f, i) => (i === 1 ? { ...f, style: "eastern" } : f)) };
    expect(sceneOf(true, eastern, dockedAt(1)).track).toBe("port_eastern");
  });

  it("停在殖民点（殖民地或荒野海湾）：拓荒者的篝火", () => {
    expect(sceneOf(true, colonialStatics, dockedAt(3)).track).toBe("port_frontier");
  });

  it("海上：旧世界的内海与外洋各一首；环境声随当地天气", () => {
    expect(sceneOf(true, statics, atSea(100, 60))).toMatchObject({ track: "sea", ambience: { place: "sea" } });
    expect(sceneOf(true, statics, atSea(300, 60)).track).toBe("ocean");
    expect(sceneOf(true, statics, atSea(100, 150)).track).toBe("ocean");
    expect(sceneOf(true, statics, atSea(100, 60, { local_weather: storm })).ambience).toEqual({ place: "sea", sky: "storm", wind: 8 });
  });

  it("海上按海区换曲：北方的冷海、内海、群岛、沙漠海岸、东方、新大陆沿岸、远洋各一首", () => {
    const inRegion = (region: number, sky: LocalWeatherView["sky"] = "clear") =>
      atSea(100, 60, { local_weather: { region, region_name: "", sky, wind_dir: 2, wind_strength: 4, forecast: [] } });
    expect(sceneOf(true, statics, inRegion(0)).track).toBe("sea_north");
    expect(sceneOf(true, statics, inRegion(4)).track).toBe("sea");
    expect(sceneOf(true, statics, inRegion(6)).track).toBe("sea_islands");
    expect(sceneOf(true, statics, inRegion(11)).track).toBe("sea_south");
    expect(sceneOf(true, statics, inRegion(12)).track).toBe("ocean");
    expect(sceneOf(true, statics, inRegion(16)).track).toBe("sea_new");
    expect(sceneOf(true, statics, inRegion(20)).track).toBe("sea_east");
    // 海区优先于坐标（坐标在旧世界里，海区是外洋）
    expect(sceneOf(true, statics, inRegion(18)).track).toBe("ocean");
    // 雾、雨照常是航海曲
    expect(sceneOf(true, statics, inRegion(0, "fog")).track).toBe("sea_north");
    expect(sceneOf(true, statics, inRegion(4, "rain"))).toMatchObject({ track: "sea", ambience: { place: "sea", sky: "rain", wind: 4 }, urgent: false });
  });

  it("海上遇到暴风雨：《怒涛》（不立即切换，照防频繁切换的规矩）；港内的暴风雨照常放港口曲；海盗优先", () => {
    expect(sceneOf(true, statics, atSea(100, 60, { local_weather: storm }))).toMatchObject({ track: "storm", urgent: false });
    expect(sceneOf(true, statics, { ...dockedAt(0), local_weather: storm }).track).toBe("port_mediterranean");
    const pirates = atSea(100, 60, { local_weather: storm, pending_battles: [{ id: 7 } as PendingView] });
    expect(sceneOf(true, statics, pirates)).toMatchObject({ track: "battle", urgent: true });
  });

  it("遭遇海盗、海战进行中：立即切换", () => {
    const pirates = atSea(100, 60, { pending_battles: [{ id: 7 } as PendingView] });
    expect(sceneOf(true, statics, pirates)).toMatchObject({ track: "battle", urgent: true });
    expect(sceneOf(true, statics, { ...dockedAt(0), tactical_battles: [3] }).track).toBe("battle");
  });
});

describe("声音偏好", () => {
  beforeEach(() => {
    localStorage.clear();
    useAudioPrefs.setState({ ...DEFAULT_PREFS });
  });

  it("本机存储里的值不合法时逐项回退到默认值", () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    localStorage.setItem(KEY, JSON.stringify({ music: 3, ambience: 0.2, muted: "yes", background: true, pick: "polka" }));
    expect(loadPrefs()).toEqual({ ...DEFAULT_PREFS, music: 1, ambience: 0.2, background: true });
    localStorage.setItem(KEY, JSON.stringify({ pick: "port_desert" }));
    expect(loadPrefs().pick).toBe("port_desert");
    localStorage.setItem(KEY, "{");
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("修改后写入本机存储，下次启动读回", () => {
    useAudioPrefs.getState().set({ music: 0.3, muted: true });
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toMatchObject({ music: 0.3, muted: true, ambience: DEFAULT_PREFS.ambience });
    expect(loadPrefs()).toMatchObject({ music: 0.3, muted: true });
  });
});

describe("音乐开关与“声音”设置", () => {
  beforeEach(() => {
    localStorage.clear();
    useAudioPrefs.setState({ ...DEFAULT_PREFS });
    useMusicStatus.setState({ active: false, track: null, resting: false });
  });

  it("点击切换静音；提示写出正在播放的曲名", async () => {
    const user = userEvent.setup();
    render(<MusicToggle />);
    const btn = screen.getByRole("button", { name: "音乐" });
    expect(btn).toHaveAttribute("aria-pressed", "true");
    expect(btn.title).toMatch(/点击画面任意处后开始播放/);
    act(() => useMusicStatus.setState({ active: true, track: "port_desert", resting: false }));
    expect(await screen.findByTitle(/正在播放：香料之路/)).toBeInTheDocument();
    await user.click(btn);
    expect(useAudioPrefs.getState().muted).toBe(true);
    expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(btn.title).toBe("音乐已关，点击开启");
  });

  it("声音一节：音量滑块、静音、后台播放与曲目（可以一直播放指定的一首）", async () => {
    const user = userEvent.setup();
    render(<SoundSection />);
    fireEvent.change(screen.getByLabelText("音乐音量"), { target: { value: "35" } });
    expect(useAudioPrefs.getState().music).toBeCloseTo(0.35);
    fireEvent.change(screen.getByLabelText("环境声音量（海浪、风雨）"), { target: { value: "0" } });
    expect(useAudioPrefs.getState().ambience).toBe(0);
    await user.click(screen.getByLabelText("切到后台时继续播放"));
    expect(useAudioPrefs.getState().background).toBe(true);
    await user.click(screen.getByLabelText("静音"));
    expect(useAudioPrefs.getState().muted).toBe(true);
    const pick = screen.getByLabelText("曲目") as HTMLSelectElement;
    expect(pick.options.length).toBe(TRACK_IDS.length + 1);
    await user.selectOptions(pick, "battle");
    expect(useAudioPrefs.getState().pick).toBe("battle");
    expect(screen.getByRole("option", { name: "黑帆" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toMatchObject({ music: 0.35, ambience: 0, background: true, muted: true, pick: "battle" });
  });
});
