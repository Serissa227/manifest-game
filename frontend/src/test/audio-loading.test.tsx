// 管弦版采样什么时候取（PERF-PLAN 第三节“首屏”）：
// - 第一次用户操作之前一个采样也不取；首屏只取正在放的那一首（主题曲）要用的，同时只下载一个；
// - 音乐关着（总静音，或音乐音量为 0）时一个也不取；
// - 换到下一首、它的采样还没到：先放合成版，到了在合成版的下一段开头换成管弦版；
// - 主界面里后台预取：只在没有要马上放的下载、浏览器空闲时一个一个取，按“接下来最可能放的”排。
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectiveStyle, likelyNext, musicOn, sceneOf, useMusic, useMusicStatus } from "../audio/director";
import { MusicEngine } from "../audio/engine";
import { downloaded, downloadStats, focusDownloads, orderIdle, pauseDownloads, resetDownloads, SampleBank, setDownloadLimit } from "../audio/orchestra/bank";
import { filesFor } from "../audio/orchestra/pick";
import { ORCH_TRACKS } from "../audio/orchestra/tracks";
import { DEFAULT_PREFS, useAudioPrefs } from "../audio/prefs";
import { realizePass } from "../audio/score";
import { TRACK_IDS, TRACKS, type TrackId } from "../audio/tracks";
import { UB_EVENT_TRACKS } from "../audio/upbringing";
import type { Overview } from "../ipc/types";
import { useGame } from "../store/game";
import { FakeAudioContext, installFakeAudio } from "./fakeAudio";
import { overview, statics } from "./fixtures";

// ───────────────────────────── 假的网络：记下要了哪些采样，可以先扣着不回

/** 采样的地址 → 文件名（不是采样时为 null）。 */
const sampleFile = (url: string): string | null => /audio\/orchestra\/([^?]+)/.exec(url)?.[1] ?? null;

interface Net {
  /** 按先后要过的采样文件 */
  requested: string[];
  /** 同时在路上的采样请求最多有几个 */
  maxInflight: number;
  /** 这个文件马上回（否则先扣着，等 release） */
  answer: (file: string) => boolean;
  /** 把扣着的都放回去 */
  release: () => void;
}

function installNet(): Net {
  let inflight = 0;
  const held: (() => void)[] = [];
  const net: Net = {
    requested: [],
    maxInflight: 0,
    answer: () => true,
    release: () => {
      for (const f of held.splice(0)) f();
    },
  };
  const reply = () => ({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
  (globalThis as { fetch?: unknown }).fetch = (url: string) => {
    const file = sampleFile(String(url));
    if (!file) return Promise.resolve(reply());
    net.requested.push(file);
    inflight++;
    net.maxInflight = Math.max(net.maxInflight, inflight);
    const done = () => {
      inflight--;
      return reply();
    };
    if (net.answer(file)) return Promise.resolve().then(done);
    return new Promise((resolve) => held.push(() => resolve(done())));
  };
  return net;
}

/** 等一会儿（让后台预取的空闲回调有机会跑：没有 requestIdleCallback 时是 200 毫秒的定时器）。 */
const idle = (ms = 450) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

function Shell() {
  useMusic();
  return <button type="button">开始</button>;
}

/** 进了游戏（舰队停在港口）。 */
const enterGame = (o: Overview = overview) => act(() => useGame.setState({ statics, overview: { ...o } }));

let restore: () => void;
let net: Net;
beforeEach(() => {
  restore = installFakeAudio();
  net = installNet();
  resetDownloads();
  FakeAudioContext.instances = [];
  localStorage.clear();
  useAudioPrefs.setState({ ...DEFAULT_PREFS });
  useMusicStatus.setState({ active: false, track: null, resting: false, orchestral: false, loading: false });
  useGame.setState({ overview: null, statics: null, error: null, message: null });
});
afterEach(() => {
  vi.restoreAllMocks();
  resetDownloads();
  restore();
  // 排着的空闲回调先取消（resetDownloads），再拿掉换上的 requestIdleCallback
  vi.unstubAllGlobals();
});

// ───────────────────────────── 纯函数

describe("音乐开关与接下来最可能放的曲子", () => {
  it("音乐关着＝总静音或音乐音量为 0；关着时按复古合成（不取采样）", () => {
    expect(musicOn(DEFAULT_PREFS)).toBe(true);
    expect(musicOn({ ...DEFAULT_PREFS, muted: true })).toBe(false);
    expect(musicOn({ ...DEFAULT_PREFS, music: 0 })).toBe(false);
    expect(effectiveStyle(DEFAULT_PREFS)).toBe("orchestral");
    expect(effectiveStyle({ ...DEFAULT_PREFS, music: 0 })).toBe("synth");
    expect(effectiveStyle({ ...DEFAULT_PREFS, muted: true })).toBe("synth");
    expect(effectiveStyle({ ...DEFAULT_PREFS, style: "synth" })).toBe("synth");
  });

  it("首屏为空；停在港口：先是出港后的航海曲，然后海战与暴风雨，不含正在放的", () => {
    expect(likelyNext(statics, null)).toEqual([]);
    const now = sceneOf(true, statics, overview).track;
    const next = likelyNext(statics, overview);
    expect(next[0].startsWith("sea") || next[0] === "ocean").toBe(true);
    expect(next.slice(1)).toEqual(["battle", "storm"]);
    expect(next).not.toContain(now);
  });

  it("在海上：先是目的港的港口曲；养成中：事件会换到的几首", () => {
    const fleet = overview.fleets[0];
    const atSea: Overview = { ...overview, fleets: [{ ...fleet, docked: null, dest: 0 }, ...overview.fleets.slice(1)] };
    const port = sceneOf(true, statics, overview).track;
    expect(likelyNext(statics, atSea)[0]).toBe(port);
    const ub = likelyNext(statics, { ...overview, mode: "upbringing" });
    expect(ub.length).toBeGreaterThan(0);
    for (const id of ub) expect(UB_EVENT_TRACKS as readonly TrackId[]).toContain(id);
  });
});

// ───────────────────────────── 下载队列

describe("采样的下载队列", () => {
  const ctx = () => new FakeAudioContext({ sampleRate: 44100 }) as unknown as BaseAudioContext;
  const title = filesFor(ORCH_TRACKS.title);

  it("前台同时最多 limit 个；后台的只在没有前台下载、空闲时才开始，一次一个", async () => {
    const bank = new SampleBank(ctx());
    net.answer = () => false;
    setDownloadLimit(2);
    void bank.ensure(title.slice(0, 5), "idle");
    expect(net.requested).toEqual([]);
    void bank.ensure(title.slice(5, 10));
    expect(net.requested).toEqual(title.slice(5, 7));
    expect(downloadStats()).toMatchObject({ active: 2, play: 3, idle: 5 });
    // 前台的都下完之前，后台的一个也不开始
    net.answer = () => true;
    net.release();
    await vi.waitFor(() => expect(downloaded(title.slice(5, 10))).toBe(true));
    expect(net.requested.filter((f) => title.slice(0, 5).includes(f))).toEqual([]);
    // 空闲时一个一个取
    await vi.waitFor(() => expect(downloaded(title.slice(0, 5))).toBe(true), { timeout: 4000 });
    expect(net.maxInflight).toBe(2);
    expect(net.requested.slice(5)).toEqual(title.slice(0, 5));
  });

  it("要放的文件从后台挪到前台；换了要放的曲子，排着的旧曲子降回后台；后台按给的顺序排", async () => {
    const bank = new SampleBank(ctx());
    net.answer = () => false;
    setDownloadLimit(1);
    void bank.ensure(title.slice(0, 3), "idle");
    void bank.ensure([title[2]]);
    expect(net.requested).toEqual([title[2]]);
    void bank.ensure(title.slice(3, 6));
    focusDownloads(title.slice(4, 6));
    expect(downloadStats()).toMatchObject({ play: 2, idle: 3 });
    orderIdle([title[3], title[1], title[0]]);
    net.answer = () => true;
    net.release();
    await vi.waitFor(() => expect(downloaded(title.slice(0, 6))).toBe(true), { timeout: 4000 });
    expect(net.requested).toEqual([title[2], title[4], title[5], title[3], title[1], title[0]]);
  });

  it("暂停时一个请求也不发，继续后照常", async () => {
    const bank = new SampleBank(ctx());
    pauseDownloads(true);
    const done = bank.ensure(title.slice(0, 3));
    await idle(300);
    expect(net.requested).toEqual([]);
    pauseDownloads(false);
    expect(await done).toBe(true);
    expect(net.requested).toEqual(title.slice(0, 3));
  });
});

// ───────────────────────────── 合成版 → 管弦版在下一段开头接上

describe("同一首换编配：在下一段开头接上", () => {
  it("每首曲子的两套编配每一遍的分段都一样（段落、先后与时刻；各自开头几毫秒的抖动不算）：都能在段落开头接上", () => {
    for (const id of TRACK_IDS) {
      expect(ORCH_TRACKS[id].forms.length, id).toBe(TRACKS[id].forms.length);
      for (let pass = 0; pass < TRACKS[id].forms.length; pass++) {
        const a = realizePass(TRACKS[id], pass).steps;
        const b = realizePass(ORCH_TRACKS[id], pass).steps;
        expect(b.map((x) => x.step), `${id}#${pass}`).toEqual(a.map((x) => x.step));
        for (let i = 0; i < a.length; i++) expect(Math.abs(a[i].t - b[i].t), `${id}#${pass}`).toBeLessThan(0.02);
      }
    }
  });

  it("接上之前听到的仍是合成版，到了下一段开头换成管弦版；不是同一首、或已在最后一段时接不上", () => {
    const id = "title";
    const ctx = new FakeAudioContext({ sampleRate: 44100 });
    const e = new MusicEngine(ctx as unknown as BaseAudioContext);
    e.play(TRACKS[id], 1);
    expect(e.handoff(ORCH_TRACKS.sea)).toBe(false);
    expect(e.handoff(ORCH_TRACKS[id])).toBe(true);
    const steps = realizePass(TRACKS[id], 0).steps;
    const at = 0.15 + steps.find((s) => 0.15 + s.t >= 0.6)!.t;
    expect(e.status()).toMatchObject({ track: id, orchestral: false });
    ctx.currentTime = at + 0.01;
    expect(e.status()).toMatchObject({ track: id, orchestral: true });
    // 已在最后一段：接不上（由导演改用交叉淡化）
    const last = new MusicEngine(new FakeAudioContext({ sampleRate: 44100 }) as unknown as BaseAudioContext);
    last.play(TRACKS[id], 1);
    (last.ctx as unknown as FakeAudioContext).currentTime = 0.15 + steps[steps.length - 1].t + 0.01;
    expect(last.handoff(ORCH_TRACKS[id])).toBe(false);
    e.close();
    last.close();
  });
});

// ───────────────────────────── 配乐导演

describe("首屏不预取整曲采样", () => {
  // 要真的加载一百多个采样（假的网络与解码），比缺省的 5 秒时限长
  it("第一次操作之前一个也不取；之后只取主题曲要用的，同时只下一个；首屏不在后台预取别的", { timeout: 30_000 }, async () => {
    const view = render(<Shell />);
    await idle();
    expect(net.requested).toEqual([]);
    fireEvent.pointerDown(screen.getByText("开始"));
    const title = new Set(filesFor(ORCH_TRACKS.title));
    await vi.waitFor(() => expect(useMusicStatus.getState()).toMatchObject({ track: "title", orchestral: true }), { timeout: 8000 });
    await idle();
    expect(new Set(net.requested)).toEqual(title);
    expect(net.requested.length).toBe(title.size);
    expect(net.maxInflight).toBe(1);
    view.unmount();
  });

  // 要真的加载一百多个采样（假的网络与解码），比缺省的 5 秒时限长
  it("进了主界面：当前的曲子先取，之后才在后台按“接下来最可能放的”取", { timeout: 30_000 }, async () => {
    const view = render(<Shell />);
    fireEvent.pointerDown(screen.getByText("开始"));
    await vi.waitFor(() => expect(useMusicStatus.getState()).toMatchObject({ track: "title", orchestral: true }), { timeout: 8000 });
    const before = net.requested.length;
    // 不让切曲等场景稳定：用点唱机指定港口曲（立即切换）
    const port = sceneOf(true, statics, overview).track;
    enterGame();
    act(() => useAudioPrefs.getState().set({ pick: port }));
    const portFiles = new Set(filesFor(ORCH_TRACKS[port]));
    const titleFiles = new Set(filesFor(ORCH_TRACKS.title));
    // 采样没到之前先放合成版
    expect(useMusicStatus.getState()).toMatchObject({ track: port, orchestral: false });
    await vi.waitFor(() => expect(downloaded(filesFor(ORCH_TRACKS[port]))).toBe(true), { timeout: 8000 });
    // 港口曲还没取完之前，后台的一个也没开始
    const fresh = net.requested.slice(before);
    const firstOther = fresh.findIndex((f) => !portFiles.has(f));
    const lastPort = fresh.map((f) => portFiles.has(f)).lastIndexOf(true);
    expect(firstOther === -1 || firstOther > lastPort).toBe(true);
    // 之后后台取接下来最可能放的那一首
    const next = likelyNext(statics, useGame.getState().overview);
    const nextFiles = filesFor(ORCH_TRACKS[next[0]]).filter((f) => !portFiles.has(f) && !titleFiles.has(f));
    await vi.waitFor(() => expect(net.requested).toContain(nextFiles[0]), { timeout: 6000 });
    view.unmount();
  });
});

describe("音乐关着时一个采样也不取", () => {
  it("总静音：不创建音频，进了游戏也一个都不取", async () => {
    useAudioPrefs.setState({ ...DEFAULT_PREFS, muted: true });
    const view = render(<Shell />);
    fireEvent.pointerDown(screen.getByText("开始"));
    enterGame();
    await idle();
    expect(FakeAudioContext.instances.length).toBe(0);
    expect(net.requested).toEqual([]);
    view.unmount();
  });

  it("音乐音量为 0（音效照常）：放合成版，进了游戏也一个都不取；把音乐开回来才开始取", async () => {
    useAudioPrefs.setState({ ...DEFAULT_PREFS, music: 0 });
    const view = render(<Shell />);
    fireEvent.pointerDown(screen.getByText("开始"));
    expect(FakeAudioContext.instances.length).toBe(1);
    enterGame();
    await idle();
    expect(useMusicStatus.getState().orchestral).toBe(false);
    expect(net.requested).toEqual([]);
    act(() => useAudioPrefs.getState().set({ music: 0.6 }));
    await vi.waitFor(() => expect(net.requested.length).toBeGreaterThan(0));
    view.unmount();
  });

  it("放着放着把音乐关掉：排着的不再发出去", async () => {
    const view = render(<Shell />);
    net.answer = () => false;
    fireEvent.pointerDown(screen.getByText("开始"));
    expect(net.requested.length).toBe(1);
    act(() => useAudioPrefs.getState().set({ muted: true }));
    net.answer = () => true;
    net.release();
    await idle();
    expect(net.requested.length).toBe(1);
    view.unmount();
  });
});

describe("换到下一首、采样还没到：先放合成版", () => {
  // 要真的加载一百多个采样（假的网络与解码），比缺省的 5 秒时限长
  it("场景换了（港口 → 海上）：等场景稳定后立即放合成版，不让旧曲子干等；采样到了换成管弦版", { timeout: 30_000 }, async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const view = render(<Shell />);
    fireEvent.pointerDown(screen.getByText("开始"));
    // 过了场景稳定的 1.5 秒、还没到先放合成版的 4 秒：主题曲的采样一到就放管弦版
    clock = 2_000;
    await vi.waitFor(() => expect(useMusicStatus.getState()).toMatchObject({ track: "title", orchestral: true }), { timeout: 8000 });
    // 进游戏之后要放的曲子：它的采样先扣着
    const want = sceneOf(true, statics, overview).track;
    const titleFiles = new Set(filesFor(ORCH_TRACKS.title));
    net.answer = (f) => titleFiles.has(f);
    clock = 20_000;
    enterGame();
    expect(useMusicStatus.getState().track).toBe("title");
    clock = 22_000;
    enterGame();
    await vi.waitFor(() => expect(useMusicStatus.getState()).toMatchObject({ track: want, orchestral: false }));
    expect(useMusicStatus.getState().loading).toBe(true);
    // 采样到了：换成管弦版（在合成版的下一段开头接上；把音频时钟拨到很后面，接上的那一刻已经过了）
    net.answer = () => true;
    net.release();
    await vi.waitFor(() => expect(useMusicStatus.getState().loading).toBe(false), { timeout: 8000 });
    FakeAudioContext.instances[0].currentTime = 400;
    clock = 23_000;
    enterGame();
    await vi.waitFor(() => expect(useMusicStatus.getState()).toMatchObject({ track: want, orchestral: true }));
    view.unmount();
  });
});

describe("首屏与进入主界面", () => {
  // 要真的加载一百多个采样（假的网络与解码），比缺省的 5 秒时限长
  it("首屏只取主题曲那一组、同时一个；进了主界面就取当前的曲子", { timeout: 30_000 }, async () => {
    const view = render(<Shell />);
    await idle();
    expect(net.requested).toEqual([]);
    fireEvent.pointerDown(screen.getByText("开始"));
    const title = new Set(filesFor(ORCH_TRACKS.title));
    await vi.waitFor(() => expect(useMusicStatus.getState()).toMatchObject({ track: "title", orchestral: true }), { timeout: 8000 });
    await idle();
    expect(new Set(net.requested)).toEqual(title);
    expect(net.requested.length).toBe(title.size);
    expect(net.maxInflight).toBe(1);
    // 进了主界面：当前的港口曲照样取
    const port = sceneOf(true, statics, overview).track;
    enterGame();
    act(() => useAudioPrefs.getState().set({ pick: port }));
    await vi.waitFor(() => expect(downloaded(filesFor(ORCH_TRACKS[port]))).toBe(true), { timeout: 8000 });
    view.unmount();
  });
});
