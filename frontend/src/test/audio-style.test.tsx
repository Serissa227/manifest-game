// 配乐风格（管弦 / 复古合成）：偏好的缺省值与旧数据的迁移、每首曲子与短乐句在两种风格下各有编配、
// 管弦版采样没加载好时放哪一套（等多久、什么时候先放合成版、加载好了再换回来）、设置里的切换与“正在播放”的提示。
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { chooseDef, cueFor, FIRST_WAIT_MS, SWITCH_WAIT_MS, trackFor, URGENT_WAIT_MS, useMusicStatus, type LoadState } from "../audio/director";
import { usesSamples } from "../audio/engine";
import { ORCH_JINGLES, ORCH_TRACKS } from "../audio/orchestra/tracks";
import { DEFAULT_PREFS, loadPrefs, useAudioPrefs } from "../audio/prefs";
import { TRACK_IDS, TRACKS } from "../audio/tracks";
import { CUE_IDS, JINGLES } from "../audio/tracks/jingles";
import { SoundSection } from "../components/panels/SoundSettings";
import MusicToggle from "../components/shell/MusicToggle";

const KEY = "manifest.audio";

describe("配乐风格的偏好", () => {
  beforeEach(() => {
    localStorage.clear();
    useAudioPrefs.setState({ ...DEFAULT_PREFS });
  });

  it("缺省是管弦", () => {
    expect(DEFAULT_PREFS.style).toBe("orchestral");
    expect(loadPrefs().style).toBe("orchestral");
  });

  it("以前存的偏好里没有这一项（老玩家）：按管弦，其余照旧读回", () => {
    localStorage.setItem(KEY, JSON.stringify({ music: 0.3, ambience: 0.2, muted: false, background: true, pick: "sea" }));
    // 偏好后来加了音效音量（音效一节）：老数据里也没有它，按缺省；整个对象仍然逐项严格比较
    expect(loadPrefs()).toEqual({ music: 0.3, ambience: 0.2, muted: false, background: true, pick: "sea", style: "orchestral", sfx: DEFAULT_PREFS.sfx });
  });

  it("不认识的值按管弦；选了复古合成会存下来，下次读回", () => {
    localStorage.setItem(KEY, JSON.stringify({ style: "chiptune" }));
    expect(loadPrefs().style).toBe("orchestral");
    useAudioPrefs.getState().set({ style: "synth" });
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toMatchObject({ style: "synth", music: DEFAULT_PREFS.music });
    expect(loadPrefs().style).toBe("synth");
  });
});

describe("两套编配", () => {
  it("每首曲子与每个短乐句在两种风格下都有编配：管弦版只用采样乐器，合成版不用；编号相同", () => {
    for (const id of TRACK_IDS) {
      expect(trackFor(id, "synth")).toBe(TRACKS[id]);
      expect(trackFor(id, "orchestral")).toBe(ORCH_TRACKS[id]);
      expect(ORCH_TRACKS[id].id).toBe(id);
      expect(usesSamples(ORCH_TRACKS[id]), id).toBe(true);
      expect(usesSamples(TRACKS[id]), id).toBe(false);
    }
    for (const id of CUE_IDS) {
      expect(cueFor(id, "synth")).toBe(JINGLES[id]);
      expect(cueFor(id, "orchestral")).toBe(ORCH_JINGLES[id]);
      expect(usesSamples(ORCH_JINGLES[id]), id).toBe(true);
    }
  });
});

describe("管弦版的采样没加载好时放哪一套", () => {
  const loading = (since: number): LoadState => ({ since, state: "loading", at: since });
  const nothing = { id: null, def: null };

  it("复古合成：总是合成版；管弦：采样都加载好了就是管弦版", () => {
    expect(chooseDef("sea", "synth", false, undefined, nothing, 0)).toBe(TRACKS.sea);
    expect(chooseDef("sea", "orchestral", true, undefined, nothing, 0)).toBe(ORCH_TRACKS.sea);
  });

  it("什么都还没放（刚点开）：最多等几秒，之后先放合成版", () => {
    expect(chooseDef("title", "orchestral", false, loading(1000), nothing, 1000 + FIRST_WAIT_MS - 1)).toBeNull();
    expect(chooseDef("title", "orchestral", false, loading(1000), nothing, 1000 + FIRST_WAIT_MS)).toBe(TRACKS.title);
  });

  it("换到下一首、它的采样还没下载到：立即先放合成版（不让旧曲子干等）", () => {
    const playing = { id: "sea" as const, def: ORCH_TRACKS.sea };
    expect(chooseDef("port_desert", "orchestral", false, loading(0), playing, 0)).toBe(TRACKS.port_desert);
    expect(chooseDef("battle", "orchestral", false, loading(0), playing, 0, true)).toBe(TRACKS.battle);
  });

  it("换到下一首、采样已下载好只差解码：旧曲子接着放（先不动），超时再放合成版；要立即切换的场景只等一会儿", () => {
    const playing = { id: "sea" as const, def: ORCH_TRACKS.sea };
    expect(chooseDef("port_desert", "orchestral", false, loading(0), playing, SWITCH_WAIT_MS - 1, false, true)).toBeNull();
    expect(chooseDef("port_desert", "orchestral", false, loading(0), playing, SWITCH_WAIT_MS, false, true)).toBe(TRACKS.port_desert);
    expect(chooseDef("battle", "orchestral", false, loading(0), playing, URGENT_WAIT_MS - 1, true, true)).toBeNull();
    expect(chooseDef("battle", "orchestral", false, loading(0), playing, URGENT_WAIT_MS, true, true)).toBe(TRACKS.battle);
    expect(URGENT_WAIT_MS).toBeLessThan(FIRST_WAIT_MS);
    expect(URGENT_WAIT_MS).toBeLessThan(SWITCH_WAIT_MS);
  });

  it("正在放的就是这一首的合成版（先顶上的，或刚把风格换成管弦）：接着放，采样加载好了再换成管弦版", () => {
    const fallback = { id: "sea" as const, def: TRACKS.sea };
    expect(chooseDef("sea", "orchestral", false, loading(0), fallback, 60000)).toBe(TRACKS.sea);
    expect(chooseDef("sea", "orchestral", true, { since: 0, state: "ready", at: 5000 }, fallback, 60000)).toBe(ORCH_TRACKS.sea);
  });

  it("加载失败：放合成版（不会没声音）", () => {
    expect(chooseDef("ocean", "orchestral", false, { since: 0, state: "failed", at: 100 }, nothing, 200)).toBe(TRACKS.ocean);
    expect(chooseDef("ocean", "orchestral", false, { since: 0, state: "failed", at: 100 }, { id: "sea", def: ORCH_TRACKS.sea }, 200)).toBe(TRACKS.ocean);
  });

  it("点唱机（指定曲目）在两种风格下都能用", () => {
    for (const id of TRACK_IDS) {
      expect(chooseDef(id, "synth", false, undefined, nothing, 0)).toBe(TRACKS[id]);
      expect(chooseDef(id, "orchestral", true, undefined, nothing, 0)).toBe(ORCH_TRACKS[id]);
    }
  });
});

describe("设置里的“配乐风格”与“正在播放”", () => {
  beforeEach(() => {
    localStorage.clear();
    useAudioPrefs.setState({ ...DEFAULT_PREFS });
    useMusicStatus.setState({ active: false, track: null, resting: false, orchestral: false, loading: false });
  });

  it("配乐风格：管弦（缺省）与复古合成，切换后存进本机", async () => {
    const user = userEvent.setup();
    render(<SoundSection />);
    const style = screen.getByLabelText("配乐风格") as HTMLSelectElement;
    expect(style.value).toBe("orchestral");
    expect([...style.options].map((o) => o.text)).toEqual(["管弦（真实乐器）", "复古合成"]);
    await user.selectOptions(style, "synth");
    expect(useAudioPrefs.getState().style).toBe("synth");
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toMatchObject({ style: "synth" });
    await user.selectOptions(style, "orchestral");
    expect(useAudioPrefs.getState().style).toBe("orchestral");
  });

  it("管弦版的采样加载中时提示一句；正在播放后面写着是哪一种编配", () => {
    render(<SoundSection />);
    expect(screen.queryByTestId("sound-loading")).toBeNull();
    act(() => useMusicStatus.setState({ active: true, track: "title", resting: false, orchestral: false, loading: true }));
    expect(screen.getByTestId("sound-loading")).toHaveTextContent("正在加载管弦乐的采样");
    expect(screen.getByTestId("sound-now")).toHaveTextContent("正在播放：船货清单 · 复古合成");
    act(() => useMusicStatus.setState({ orchestral: true, loading: false }));
    expect(screen.queryByTestId("sound-loading")).toBeNull();
    expect(screen.getByTestId("sound-now")).toHaveTextContent("正在播放：船货清单 · 管弦");
  });

  it("顶栏的音乐开关：悬停提示里写着是管弦版还是复古合成版", () => {
    render(<MusicToggle />);
    act(() => useMusicStatus.setState({ active: true, track: "ocean", resting: false, orchestral: true }));
    expect(screen.getByRole("button", { name: "音乐" }).title).toBe("正在播放：晨星洋 · 管弦\n音乐已开，点击静音");
    act(() => useMusicStatus.setState({ orchestral: false, resting: true }));
    expect(screen.getByRole("button", { name: "音乐" }).title).toBe("晨星洋（间歇中） · 复古合成\n音乐已开，点击静音");
  });
});
