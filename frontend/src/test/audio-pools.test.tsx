// 曲目池的轮换接进配乐导演（第九批 A01，2026-11-11）：用寰宇的真实数据与假的音频（test/fakeAudio.ts，音频时间由测试拨动）——
// 大西洋的远洋放的是池的第一首《信风带》（不是原来借的伊比利亚沿岸的那一首）；伊比利亚外海的航海曲奏完一遍、在留白里停够了，
// 导演立即换到池里的下一首；天黑以后进港先放写傍晚的那一首；点唱机（指定了曲目）时不轮。
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMusic, useMusicStatus } from "../audio/director";
import { POOL_RULES } from "../audio/pools";
import { DEFAULT_PREFS, useAudioPrefs } from "../audio/prefs";
import { realizePass, rng } from "../audio/score";
import { TRACKS } from "../audio/tracks";
import type { LocalWeatherView, Overview } from "../ipc/types";
import { useGame } from "../store/game";
import { FakeAudioContext, installFakeAudio } from "./fakeAudio";
import { overview } from "./fixtures";
import { TERRA16_REGIONS, terra16Statics } from "./terra16";

const terra = terra16Statics();
const regionId = (key: string) => TERRA16_REGIONS.findIndex((r) => r.key === key);

function Shell() {
  useMusic(rng(20261111));
  return <button type="button">开始</button>;
}

function atSea(region: number): Overview {
  return {
    ...overview,
    mode: "voyage",
    fleets: [{ ...overview.fleets[0], docked: null, x: 100, y: 60 }],
    local_weather: { region, region_name: "", sky: "clear", wind_dir: 2, wind_strength: 4, forecast: [] } as unknown as LocalWeatherView,
  } as Overview;
}

function dockedAt(place: string, minute: number): Overview {
  const loc = terra.locations.find((l) => l.key === place);
  if (!loc) throw new Error(place);
  return { ...overview, mode: "voyage", minute, fleets: [{ ...overview.fleets[0], docked: loc.id }] } as Overview;
}

const tick = () => act(() => new Promise<void>((r) => setTimeout(r, 1200)));

let restore: () => void;
beforeEach(() => {
  restore = installFakeAudio();
  localStorage.clear();
  // 复古合成：不取采样，换曲立刻就是这一首
  useAudioPrefs.setState({ ...DEFAULT_PREFS, style: "synth" });
  useMusicStatus.setState({ active: false, track: null, resting: false, orchestral: false, loading: false });
});
afterEach(() => {
  restore();
  useGame.setState({ overview: null, statics: null, error: null, message: null });
});

describe("曲目池的轮换（配乐导演）", () => {
  it("大西洋的远洋：放池的第一首《信风带》", () => {
    useGame.setState({ statics: terra, overview: atSea(regionId("south_atlantic")), error: null, message: null });
    const view = render(<Shell />);
    fireEvent.pointerDown(screen.getByText("开始"));
    expect(useMusicStatus.getState()).toMatchObject({ active: true, track: "sea_atlantic" });
    view.unmount();
  });

  it("伊比利亚外海：先放《圣文森特角的帆》；奏完一遍、在留白里停够了，立即换到《加那利的顺风》；留白停得不够时不换", { timeout: 30_000 }, async () => {
    useGame.setState({ statics: terra, overview: atSea(regionId("iberia")), error: null, message: null });
    const view = render(<Shell />);
    fireEvent.pointerDown(screen.getByText("开始"));
    expect(useMusicStatus.getState().track).toBe("sea_iberia");
    const ctx = FakeAudioContext.instances[0];
    await tick();
    const len = realizePass(TRACKS.sea_iberia, 0).length;
    // 还没奏完
    ctx.currentTime = 0.15 + len - 1;
    await tick();
    expect(useMusicStatus.getState().track).toBe("sea_iberia");
    // 奏完了，留白里才停了几秒
    ctx.currentTime = 0.15 + len + POOL_RULES.sea.rest! - 6;
    await tick();
    expect(useMusicStatus.getState().track).toBe("sea_iberia");
    // 停够了：换
    ctx.currentTime = 0.15 + len + POOL_RULES.sea.rest! + 1;
    await vi.waitFor(() => expect(useMusicStatus.getState().track).toBe("sea_canaries"), { timeout: 4000 });
    view.unmount();
  });

  it("天黑以后进里斯本：先放《贝伦的晚钟》；白天进港先放《橙花码头》", () => {
    useGame.setState({ statics: terra, overview: dockedAt("lisbon", 22 * 60), error: null, message: null });
    const night = render(<Shell />);
    fireEvent.pointerDown(screen.getByText("开始"));
    expect(useMusicStatus.getState().track).toBe("port_iberia_eve");
    night.unmount();
    restore();
    restore = installFakeAudio();
    useMusicStatus.setState({ active: false, track: null, resting: false, orchestral: false, loading: false });
    useGame.setState({ statics: terra, overview: dockedAt("lisbon", 10 * 60), error: null, message: null });
    const day = render(<Shell />);
    fireEvent.pointerDown(screen.getByText("开始"));
    expect(useMusicStatus.getState().track).toBe("port_iberia");
    day.unmount();
  });

  it("点唱机（指定了曲目）时放指定的那一首，轮换不走", { timeout: 20_000 }, async () => {
    useAudioPrefs.setState({ ...DEFAULT_PREFS, style: "synth", pick: "sea_iberia" });
    useGame.setState({ statics: terra, overview: atSea(regionId("iberia")), error: null, message: null });
    const view = render(<Shell />);
    fireEvent.pointerDown(screen.getByText("开始"));
    expect(useMusicStatus.getState().track).toBe("sea_iberia");
    const ctx = FakeAudioContext.instances[0];
    await tick();
    ctx.currentTime = 0.15 + realizePass(TRACKS.sea_iberia, 0).length + POOL_RULES.sea.rest! + 5;
    await tick();
    await tick();
    expect(useMusicStatus.getState().track).toBe("sea_iberia");
    view.unmount();
  });
});
