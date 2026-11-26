// 音效与界面：设置里的“音效音量”滑条与偏好的迁移；全局点击委托（禁用的按钮与 data-sfx="none" 不响、打开窗口时不再“嗒”一下）；
// 勾选框、滑条的档位；错误、提示、存档、读档；游戏状态的差（卖出 → 全部卖出、出港；读档不算）；
// 音频引擎里音效总线的接法（总的静音静掉音效，音乐音量为 0 时音效照常，短乐句让音效让开）；配乐导演解锁音频时接上音效。
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMusic } from "../audio/director";
import { MusicEngine, SFX_DEFAULT } from "../audio/engine";
import { DEFAULT_PREFS, loadPrefs, useAudioPrefs } from "../audio/prefs";
import { attachSfx, bindSfx, sfxPlayer, useSfx, type SfxPlayer } from "../audio/sfx";
import { SFX, type SfxId } from "../audio/sfx/events";
import { JINGLES } from "../audio/tracks/jingles";
import { SoundSection } from "../components/panels/SoundSettings";
import { closeWindow, openWindow, useShell } from "../components/shell/shellState";
import type { Overview } from "../ipc/types";
import { useGame } from "../store/game";
import { FakeAudioContext, installFakeAudio, lastTarget, type FakeNode, type FakeParam } from "./fakeAudio";

const KEY = "manifest.audio";

describe("设置：音效音量", () => {
  beforeEach(() => {
    localStorage.clear();
    useAudioPrefs.setState({ ...DEFAULT_PREFS });
  });

  it("缺省 70%；拖动滑条改音效音量，存进本机", () => {
    render(<SoundSection />);
    const slider = screen.getByLabelText("音效音量") as HTMLInputElement;
    expect(slider.value).toBe("70");
    fireEvent.change(slider, { target: { value: "35" } });
    expect(useAudioPrefs.getState().sfx).toBeCloseTo(0.35);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toMatchObject({ sfx: 0.35 });
    expect(loadPrefs().sfx).toBeCloseTo(0.35);
    // 其余的音量不受影响
    expect(useAudioPrefs.getState().music).toBe(DEFAULT_PREFS.music);
  });

  it("老玩家存的偏好里没有音效音量：按缺省 70%；不合法的值回退或夹到 0–1", () => {
    localStorage.setItem(KEY, JSON.stringify({ music: 0.3, ambience: 0.2, muted: false, background: true, pick: "auto", style: "synth" }));
    expect(loadPrefs()).toEqual({ ...DEFAULT_PREFS, music: 0.3, ambience: 0.2, background: true, style: "synth", sfx: 0.7 });
    localStorage.setItem(KEY, JSON.stringify({ sfx: "loud" }));
    expect(loadPrefs().sfx).toBe(0.7);
    localStorage.setItem(KEY, JSON.stringify({ sfx: 3 }));
    expect(loadPrefs().sfx).toBe(1);
    localStorage.setItem(KEY, JSON.stringify({ sfx: 0 }));
    expect(loadPrefs().sfx).toBe(0);
    expect(DEFAULT_PREFS.sfx).toBe(SFX_DEFAULT);
  });

  it("说明里写着“静音”会连音效一起静掉、只想关音乐时把音乐音量拖到 0", () => {
    render(<SoundSection />);
    expect(screen.getByText(/“静音”会连音效一起静掉/)).toBeInTheDocument();
  });
});

// ───────────────────────────── 全局事件委托（假的播放器，只记下放了什么）

class RecordingPlayer {
  played: { id: SfxId; rate?: number }[] = [];
  stamp = 0;
  last = { at: -Infinity, priority: -1 };
  load = vi.fn(() => Promise.resolve(true));
  play(id: SfxId, opts: { rate?: number } = {}) {
    this.played.push({ id, rate: opts.rate });
    this.stamp++;
    this.last = { at: performance.now(), priority: SFX[id].priority };
    return true;
  }
  ids() {
    return this.played.map((p) => p.id);
  }
}

/** 等这一下点击的处理（点击委托在下一个任务里才决定响什么）与概览的微任务都结束。 */
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 5)));

function fleetAt(docked: number | null, cargo: Overview["fleets"][number]["cargo"]): Overview["fleets"][number] {
  return {
    id: 1,
    docked,
    dest: null,
    x: 0,
    y: 0,
    path: [],
    days_at_sea: 0,
    ships: [{ kind: 0, durability: 80, max_durability: 100, capacity: 50, guns: 4, refits: [], resale: 1000 }],
    crew: 20,
    crew_min: 10,
    crew_max: 40,
    morale: 80,
    food: 10,
    water: 10,
    daily_need: 1,
    capacity: 50,
    used: 10,
    cargo,
    repair_cost: 0,
  };
}

function overview(cash: number, docked: number | null, cargo: Overview["fleets"][number]["cargo"]): Overview {
  return {
    day: 10,
    year: 1,
    calendar_year: 1502,
    month: 1,
    date: 11,
    season: 0,
    scenario: "s",
    cash,
    deposit: 0,
    loans: 0,
    net_worth: 20000,
    total_assets: 21000,
    speed: 1,
    ai_mode: "Off",
    budget: null,
    fleets: [fleetAt(docked, cargo)],
    caravans: [],
    others: [],
    winds: [],
    notices: [],
    reorganizations: 0,
    pending_battles: [],
    tactical_battles: [],
    pirates: [],
    fog_version: 0,
    goal: null,
    outcome: null,
    fame: 0,
    colonies: [],
    discoveries_unreported: 0,
    site_claims: [],
  } as Overview;
}

describe("全局事件委托与游戏状态的差", () => {
  let player: RecordingPlayer;
  let off: () => void;

  beforeEach(() => {
    player = new RecordingPlayer();
    bindSfx(player as unknown as SfxPlayer);
    off = attachSfx();
    useShell.setState({ windowOpen: false });
    useGame.setState({ overview: null, error: null, message: null, stage: "town", facility: "market" });
  });

  afterEach(() => {
    off();
    bindSfx(null);
  });

  it("接上播放器时先解码界面的素材", () => {
    expect(player.load).toHaveBeenCalled();
    expect(sfxPlayer()).toBe(player);
  });

  it("点按钮“嗒”；禁用的按钮与写了 data-sfx=\"none\" 的不响；页签翻页；data-sfx 指定的照指定的响", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">普通</button>
        <button type="button" disabled>
          禁用
        </button>
        <button type="button" data-sfx="none">
          静音按钮
        </button>
        <div role="tablist">
          <button type="button" role="tab" aria-selected={false}>
            页签
          </button>
        </div>
        <button type="button" data-sfx="save">
          指定
        </button>
      </div>,
    );
    await user.click(screen.getByText("普通"));
    await settle();
    expect(player.ids()).toEqual(["click"]);
    fireEvent.click(screen.getByText("禁用"));
    await user.click(screen.getByText("静音按钮"));
    await settle();
    expect(player.ids()).toEqual(["click"]);
    await user.click(screen.getByText("页签"));
    await user.click(screen.getByText("指定"));
    await settle();
    expect(player.ids()).toEqual(["click", "tab", "save"]);
  });

  it("点了打开 / 关上窗口的按钮：只响开关窗口的声音，不再“嗒”一下；没有用户操作时自动打开的窗口不响", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button" onClick={() => openWindow()}>
          打开
        </button>
        <button type="button" onClick={() => closeWindow()}>
          关上
        </button>
      </div>,
    );
    await user.click(screen.getByText("打开"));
    await settle();
    expect(player.ids()).toEqual(["open"]);
    await user.click(screen.getByText("关上"));
    await settle();
    expect(player.ids()).toEqual(["open", "close"]);
    // 过了一会儿，程序自己打开窗口（例如入港时）
    await act(() => new Promise<void>((r) => setTimeout(r, 600)));
    act(() => openWindow());
    await settle();
    expect(player.ids()).toEqual(["open", "close"]);
  });

  it("勾选框：勾上与取消各一声（点在文字上也一样）；滑条每过一档轻响，越往右越高", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <label>
          <input type="checkbox" />
          <span>后台播放</span>
        </label>
        <input type="range" aria-label="音量" min={0} max={100} defaultValue={0} />
      </div>,
    );
    await user.click(screen.getByText("后台播放"));
    await user.click(screen.getByRole("checkbox"));
    await settle();
    expect(player.ids()).toEqual(["toggleOn", "toggleOff"]);
    player.played = [];
    const range = screen.getByLabelText("音量");
    fireEvent.pointerDown(range);
    fireEvent.input(range, { target: { value: "2" } });
    fireEvent.input(range, { target: { value: "3" } });
    fireEvent.input(range, { target: { value: "30" } });
    fireEvent.input(range, { target: { value: "90" } });
    expect(player.ids()).toEqual(["slider", "slider", "slider"]);
    const rates = player.played.map((p) => p.rate ?? 0);
    expect(rates[1]).toBeGreaterThan(rates[0]);
    expect(rates[2]).toBeGreaterThan(rates[1]);
  });

  it("错误：钱不够是空钱袋，其余是“被拒”；卷轴提示：存档、读档各有声音，一般的提示在刚响过别的声音时不响", async () => {
    act(() => useGame.setState({ message: "抵达卡迪尔港。" }));
    expect(player.ids()).toEqual(["notify"]);
    act(() => useGame.setState({ error: "现金不够。", message: null }));
    act(() => useGame.setState({ error: "舱位不足：需要 20，空余 5" }));
    act(() => useGame.setState({ error: null, message: "已存档：save1" }));
    expect(player.ids()).toEqual(["notify", "broke", "error", "save"]);
    // 刚存完档又来一句一般的提示：不再出声
    act(() => useGame.setState({ message: "别的提示" }));
    expect(player.ids()).toEqual(["notify", "broke", "error", "save"]);
  });

  it("卖出：第一笔“卖出”，紧接着的下一笔是“全部卖出”，再往后同一串不响；出港不要求用户操作", async () => {
    const hold = [{ good: 1, qty: 10, avg_cost: 30 }, { good: 2, qty: 10, avg_cost: 30 }, { good: 3, qty: 10, avg_cost: 30 }];
    act(() => useGame.setState({ overview: overview(1000, 3, hold) }));
    await settle();
    fireEvent.pointerDown(document.body);
    act(() => useGame.setState({ overview: overview(1400, 3, hold.slice(1)) }));
    await settle();
    act(() => useGame.setState({ overview: overview(1800, 3, hold.slice(2)) }));
    await settle();
    act(() => useGame.setState({ overview: overview(2200, 3, []) }));
    await settle();
    expect(player.ids()).toEqual(["sell", "sellAll"]);
    act(() => useGame.setState({ overview: overview(2200, null, []) }));
    await settle();
    expect(player.ids()).toEqual(["sell", "sellAll", "depart"]);
  });

  it("同一次更新里卖掉好几种货（一条命令卖光）：直接响“全部卖出”", async () => {
    const hold = [{ good: 1, qty: 10, avg_cost: 30 }, { good: 2, qty: 10, avg_cost: 30 }];
    act(() => useGame.setState({ overview: overview(1000, 3, hold) }));
    await settle();
    fireEvent.pointerDown(document.body);
    act(() => useGame.setState({ overview: overview(2600, 3, []) }));
    await settle();
    expect(player.ids()).toEqual(["sellAll"]);
  });

  it("没有用户操作时（运行中每天的结算）现金与货舱的变化不响；读档时整个概览换了，前后的差不算，只响读档", async () => {
    act(() => useGame.setState({ overview: overview(1000, 3, [{ good: 1, qty: 10, avg_cost: 30 }]) }));
    await settle();
    await act(() => new Promise<void>((r) => setTimeout(r, 10)));
    act(() => useGame.setState({ overview: overview(1500, 3, []) }));
    await settle();
    expect(player.ids()).toEqual([]);
    fireEvent.pointerDown(document.body);
    act(() => {
      useGame.setState({ overview: overview(900, 3, [{ good: 1, qty: 20, avg_cost: 30 }]) });
      useGame.setState({ message: "已读档：save1" });
    });
    await settle();
    expect(player.ids()).toEqual(["load"]);
  });
});

// ───────────────────────────── 音频引擎里的音效总线

/** 从 from 走到 to 经过的全部节点（所有路径）。 */
function pathNodes(ctx: FakeAudioContext, from: FakeNode, to: FakeNode): FakeNode[] {
  const out = new Set<FakeNode>();
  const walk = (n: FakeNode, trail: FakeNode[]) => {
    if (trail.includes(n)) return;
    if (n === to) {
      for (const x of trail) out.add(x);
      return;
    }
    for (const o of n.outputs) walk(o, [...trail, n]);
  };
  walk(from, []);
  void ctx;
  return [...out];
}

const gainOf = (n: FakeNode) => (n.kind === "gain" ? ((n.gain as FakeParam | undefined) ?? null) : null);

describe("音频引擎：音效总线", () => {
  let restore: () => void;
  beforeEach(() => {
    restore = installFakeAudio();
  });
  afterEach(() => restore());

  it("音效经过总音量、压限器到输出；总的静音静掉音效，音乐音量为 0 时音效照常，音效音量为 0 时不响", async () => {
    const ctx = new FakeAudioContext({ sampleRate: 44100 });
    const e = new MusicEngine(ctx as unknown as BaseAudioContext);
    expect(await e.sfx.load(["ui.click"])).toBe(true);
    expect(e.sfx.play("click", {}, 0)).toBe(true);
    const src = ctx.startedSources().at(-1)!;
    const comp = ctx.nodes.find((n) => n.kind === "compressor")!;
    expect(ctx.reaches(src, comp)).toBe(true);
    expect(ctx.reaches(src, ctx.destination)).toBe(true);
    const onPath = pathNodes(ctx, src, ctx.destination).filter((n) => gainOf(n));
    const gains = () => onPath.map((n) => lastTarget(gainOf(n)!));
    // 只把音乐与环境声关掉：音效的路上没有一个增益是 0
    e.setVolumes(0, 0, false, 0.7);
    expect(gains().every((g) => g > 0)).toBe(true);
    // 总的静音：路上有一个增益（总音量）变成 0
    e.setVolumes(0.6, 0.5, true, 0.7);
    expect(gains().some((g) => g === 0)).toBe(true);
    // 音效音量为 0
    e.setVolumes(0.6, 0.5, false, 0);
    expect(gains().some((g) => g === 0)).toBe(true);
    // 缺省音量时音效总线的增益为 1
    e.setVolumes(0.6, 0.5, false, 0.7);
    expect(gains().every((g) => g > 0)).toBe(true);
    // 音效不经过音乐总线：音乐音量为 0、音效音量缺省时，路上的增益都不受音乐音量影响
    e.setVolumes(0, 0.5, false, 0.7);
    expect(gains().every((g) => g > 0)).toBe(true);
    e.close();
  });

  it("奏短乐句时告诉音效让开（从短乐句开始到奏完）", () => {
    const ctx = new FakeAudioContext({ sampleRate: 44100 });
    const e = new MusicEngine(ctx as unknown as BaseAudioContext);
    const spy = vi.spyOn(e.sfx, "jingle");
    expect(e.cue(JINGLES.depart, 3)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const [start, end] = spy.mock.calls[0];
    expect(start).toBe(3);
    expect(end).toBeGreaterThan(start + 2);
    expect(e.sfx.inJingle(4)).toBe(true);
    e.close();
  });
});

// ───────────────────────────── 配乐导演解锁音频时接上音效

function Shell() {
  useMusic();
  useSfx();
  return <button type="button">开始</button>;
}

describe("解锁音频（沿用配乐导演）", () => {
  let restore: () => void;
  beforeEach(() => {
    restore = installFakeAudio();
    localStorage.clear();
    useAudioPrefs.setState({ ...DEFAULT_PREFS });
    useGame.setState({ overview: null, statics: null, error: null, message: null });
  });
  afterEach(() => restore());

  it("第一次用户操作之前没有播放器；第一次操作时创建音频、接上音效，卸下时断开", () => {
    const view = render(<Shell />);
    expect(sfxPlayer()).toBeNull();
    fireEvent.pointerDown(screen.getByText("开始"));
    expect(FakeAudioContext.instances.length).toBe(1);
    expect(sfxPlayer()).not.toBeNull();
    view.unmount();
    expect(sfxPlayer()).toBeNull();
  });

  it("静音时不创建音频，也就没有音效；取消静音（这本身是一次操作）时接上", () => {
    useAudioPrefs.setState({ ...DEFAULT_PREFS, muted: true });
    const view = render(<Shell />);
    fireEvent.pointerDown(screen.getByText("开始"));
    expect(FakeAudioContext.instances.length).toBe(0);
    expect(sfxPlayer()).toBeNull();
    act(() => useAudioPrefs.getState().set({ muted: false }));
    expect(sfxPlayer()).not.toBeNull();
    view.unmount();
  });

  it("音效音量随偏好变化（音效总线的增益跟着变）", () => {
    const view = render(<Shell />);
    fireEvent.pointerDown(screen.getByText("开始"));
    const ctx = FakeAudioContext.instances[0];
    const busGains = () => ctx.nodes.filter((n) => n.kind === "gain").map((n) => lastTarget(gainOf(n)!));
    act(() => useAudioPrefs.getState().set({ sfx: 0 }));
    const zeroed = busGains().filter((g) => g === 0).length;
    act(() => useAudioPrefs.getState().set({ sfx: 0.7 }));
    expect(busGains().filter((g) => g === 0).length).toBeLessThan(zeroed);
    view.unmount();
  });
});
