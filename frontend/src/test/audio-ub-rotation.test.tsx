// 养成平时的轮换接进配乐导演（第九批 2026-11-02）：随机源可注入（这里固定种子），引擎里正在放的曲子奏完一遍、进了留白，
// 导演就立即换到轮换的下一首（不等场景稳定），同一首不连着放；后台先取的是轮换接下来的那一首；事件的曲子立即换上，放的时候轮换停着不走。
// 用假的音频（test/fakeAudio.ts）：音频时间（AudioContext.currentTime）由测试拨动，配乐导演每秒看一次。
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { likelyNext, useMusic, useMusicStatus } from "../audio/director";
import { DEFAULT_PREFS, useAudioPrefs } from "../audio/prefs";
import { realizePass, rng } from "../audio/score";
import { TRACKS, type TrackId } from "../audio/tracks";
import { everydayPool, nextRotation, startRotation, UB_EVENT_TRACKS, useUbMusic, type UbMusicDigest } from "../audio/upbringing";
import type { Overview } from "../ipc/types";
import { useGame } from "../store/game";
import { FakeAudioContext, installFakeAudio } from "./fakeAudio";
import { overview, statics } from "./fixtures";

const SEED = 20261102;

function Shell() {
  useMusic(rng(SEED));
  return <button type="button">开始</button>;
}

const digest: UbMusicDigest = { stage: "home", phase: "plan", festival: false, contestDay: false, contestOpen: false, academy: null, protagonist: "noel" };
const upbringing = { ...overview, mode: "upbringing" } as Overview;

/** 同一个种子、同样的曲目池，轮换依次放的曲子。 */
function expected(n: number): TrackId[] {
  const rand = rng(SEED);
  let rot = startRotation(everydayPool(digest), rand);
  const out = [rot.current];
  while (out.length < n) {
    rot = nextRotation(rot, rand);
    out.push(rot.current);
  }
  return out;
}

let restore: () => void;
beforeEach(() => {
  restore = installFakeAudio();
  localStorage.clear();
  // 复古合成：不取采样，换曲立刻就是这一首
  useAudioPrefs.setState({ ...DEFAULT_PREFS, style: "synth" });
  useMusicStatus.setState({ active: false, track: null, resting: false, orchestral: false, loading: false });
  useUbMusic.setState({ digest });
  useGame.setState({ statics, overview: upbringing, error: null, message: null });
});
afterEach(() => {
  restore();
  useUbMusic.setState({ digest: null });
  useGame.setState({ overview: null, statics: null, error: null, message: null });
});

describe("养成平时的轮换（配乐导演）", () => {
  it("先放这个阶段的曲子；一首奏完一遍、进了留白，立即换到轮换的下一首，同一首不连着放，次序由注入的随机源定", { timeout: 40_000 }, async () => {
    const order = expected(6);
    expect(order[0]).toBe("ub_home");
    expect(new Set(order).size).toBe(6);
    const view = render(<Shell />);
    fireEvent.pointerDown(screen.getByText("开始"));
    expect(useMusicStatus.getState()).toMatchObject({ active: true, track: "ub_home", orchestral: false });
    const ctx = FakeAudioContext.instances[0];
    await act(() => new Promise<void>((r) => setTimeout(r, 1200)));
    // 每首都是第一次放（从第 0 遍开始），开始的时刻是换曲那一刻的音频时间 + 0.15 秒
    let start = 0.15;
    for (let i = 1; i < order.length; i++) {
      const len = realizePass(TRACKS[order[i - 1]], 0).length;
      // 还差一点没奏完：不换
      ctx.currentTime = start + len - 1;
      await act(() => new Promise<void>((r) => setTimeout(r, 1200)));
      expect(useMusicStatus.getState().track, `第 ${i} 首还没奏完`).toBe(order[i - 1]);
      // 奏完、在留白里停了 4 秒：换到下一首
      ctx.currentTime = start + len + 4;
      await vi.waitFor(() => expect(useMusicStatus.getState().track, `第 ${i + 1} 首`).toBe(order[i]), { timeout: 4000 });
      start = ctx.currentTime + 0.15;
      // 导演下一次看（一秒一次）时记下它从这一刻开始放
      await act(() => new Promise<void>((r) => setTimeout(r, 1200)));
    }
    view.unmount();
  });

  it("后台先取的是轮换接下来的那一首（然后才是事件会换到的几首）", () => {
    const rand = rng(SEED);
    const rot = startRotation(everydayPool(digest), rand);
    const next = likelyNext(statics, upbringing, digest, rot);
    expect(next[0]).toBe(rot.queue[0]);
    expect(next.slice(1)).toEqual(UB_EVENT_TRACKS.filter((id) => id !== rot.queue[0]));
    expect(next).not.toContain(rot.current);
  });

  it("事件的曲子立即换上；它放着的时候即使奏完了一遍，轮换也停着不走", { timeout: 20_000 }, async () => {
    const view = render(<Shell />);
    fireEvent.pointerDown(screen.getByText("开始"));
    expect(useMusicStatus.getState().track).toBe("ub_home");
    const sad = {
      ...upbringing,
      story: { line: null, pending: { day: 1, fleet: 0, kind: "upbringing", key: "ev", title: "", text: "", speaker: { name: "" }, choices: [], mood: "sad" }, last: null, journal: [] },
    } as unknown as Overview;
    act(() => useGame.setState({ overview: sad }));
    expect(useMusicStatus.getState().track).toBe("ub_sad");
    // 悲伤的曲子奏完一遍、在留白里：仍是它（轮换只看轮到的那一首）
    const ctx = FakeAudioContext.instances[0];
    ctx.currentTime = 0.15 + realizePass(TRACKS.ub_sad, 0).length + 4;
    await act(() => new Promise<void>((r) => setTimeout(r, 2200)));
    expect(useMusicStatus.getState().track).toBe("ub_sad");
    view.unmount();
  });
});
