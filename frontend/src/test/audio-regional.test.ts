// 地方乐器在音频引擎里的发声（假的 Web Audio）：吹奏与弓弦的乐句里，跟着波形起伏的气声、起音的一口气、气息的起伏与音高的慢漂都接上了；
// 弯音（!bend! !fall!）与深揉（!vib!）排到了振荡器与拨弦的缓冲源上；ABC 认得这几种装饰，展开后带在音符事件上。
import { describe, expect, it } from "vitest";
import { parseAbc } from "../audio/abc";
import { BEND, bendCurve, FALL, PLUCK_VIB, Synth } from "../audio/engine";
import { INSTRUMENTS, type SustainSpec } from "../audio/instruments";
import { realizePass, type NoteEvent, type TrackDef } from "../audio/score";
import { parseKey } from "../audio/theory";
import { FakeAudioContext, type FakeNode, type FakeParam } from "./fakeAudio";

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function setup() {
  const ctx = new FakeAudioContext({ sampleRate: 44100 });
  const synth = new Synth(ctx as unknown as BaseAudioContext);
  const dest = ctx.createGain();
  const out = new Set<AudioScheduledSourceNode>();
  return { ctx, synth, dest: dest as unknown as AudioNode, out };
}

/** 连到某个参数（而不是节点）上的节点。 */
function feeding(ctx: FakeAudioContext, p: FakeParam): FakeNode[] {
  return ctx.nodes.filter((n) => n.outputs.includes(p as unknown as FakeNode));
}

function sustain(id: string): SustainSpec {
  const i = INSTRUMENTS[id];
  if (i.kind === "pluck" || i.kind === "mallet" || i.kind === "perc") throw new Error(id);
  return i;
}

const note = (t: number, d: number, m: number, deco?: string[], legato?: boolean): NoteEvent => ({ t, d, v: 0.8, voice: "v", m, ...(deco ? { deco } : {}), ...(legato ? { legato } : {}) });

describe("吹奏与弓弦的乐句（地方乐器）", () => {
  it("尺八：气声、跟着波形起伏的气声、起音的一口气、吐音四层噪声；振荡器的波形调制一个增益；气息起伏与音高慢漂的低频振荡器都接上", () => {
    const { ctx, synth, dest, out } = setup();
    const spec = sustain("shakuhachi");
    synth.phrase([note(1, 1.2, 62), note(2.3, 1.5, 65)], "shakuhachi", spec, dest, 0, out);
    const noise = ctx.nodes.filter((n) => n.kind === "source" && n.loop === true);
    expect(noise.length).toBe(4);
    // 跟着波形起伏：有一个增益节点的 gain 参数由振荡器（或振荡器的混合）推着
    const gains = ctx.nodes.filter((n) => n.kind === "gain");
    const modulated = gains.filter((g) => feeding(ctx, g.gain as FakeParam).some((n) => n.kind === "oscillator" || n.kind === "gain"));
    expect(modulated.length).toBeGreaterThanOrEqual(2);
    // 气息起伏：约 0.8 Hz 的低频振荡器；音高慢漂：0.23 与 0.37 Hz 附近两个，推着主振荡器的 detune
    const lfos = ctx.nodes.filter((n) => n.kind === "oscillator" && (n.frequency as FakeParam).value < 2);
    expect(lfos.some((n) => Math.abs((n.frequency as FakeParam).value - 0.8) < 0.1)).toBe(true);
    const drift = lfos.filter((n) => (n.frequency as FakeParam).value < 0.5);
    expect(drift.length).toBe(2);
    const main = ctx.nodes.filter((n) => n.kind === "oscillator" && (n.frequency as FakeParam).value >= 2 && (n.frequency as FakeParam).events.some((e) => e[1] > 200));
    expect(main.length).toBe(1);
    expect(feeding(ctx, main[0].detune as FakeParam).length).toBeGreaterThanOrEqual(3);
  });

  it("!bend! 从低一个全音处上来，!fall! 在音尾往下落，!vib! 揉得更深", () => {
    const { ctx, synth, dest, out } = setup();
    const spec = sustain("erhu");
    synth.phrase([note(1, 1, 62, ["bend"]), note(2, 1.2, 64, ["fall", "vib"])], "erhu", spec, dest, 0, out);
    const osc = ctx.nodes.find((n) => n.kind === "oscillator" && (n.frequency as FakeParam).events.some((e) => e[1] > 200))!;
    const ev = (osc.frequency as FakeParam).events;
    const f1 = hz(62);
    const f2 = hz(64);
    expect(ev.some((e) => e[0] === "set" && Math.abs(e[1] - f1 * BEND.depth) < 0.01 && Math.abs(e[2] - 1) < 1e-9)).toBe(true);
    expect(ev.some((e) => e[0] === "target" && Math.abs(e[1] - f1) < 0.01 && e[2] > 1 && e[2] < 1.1)).toBe(true);
    expect(ev.some((e) => e[0] === "target" && Math.abs(e[1] - f2 * FALL.depth) < 0.01 && Math.abs(e[2] - (2 + 1.2 * FALL.at)) < 1e-6)).toBe(true);
    // 揉音的深度：第二个音（写了 vib）是缺省的 vibBoost 倍
    const depthGains = ctx.nodes.filter((n) => n.kind === "gain" && (n.gain as FakeParam).events.some((e) => e[0] === "target" && e[1] > 1));
    const targets = depthGains.flatMap((g) => (g.gain as FakeParam).events.filter((e) => e[0] === "target" && e[1] > 1).map((e) => e[1]));
    expect(targets).toContain(spec.vib!.depth);
    expect(targets.some((v) => Math.abs(v - spec.vib!.depth * (spec.vibBoost ?? 2.2)) < 1e-9)).toBe(true);
  });
});

describe("拨弦的弯音与揉弦（地方乐器）", () => {
  it("bendCurve：bend 先停在低一个全音、再回到本音；fall 在音尾往下；都没有时是 1", () => {
    expect(bendCurve(undefined, 0.5, 1)).toBe(1);
    expect(bendCurve(["bend"], 0, 1)).toBeCloseTo(BEND.depth, 9);
    expect(bendCurve(["bend"], BEND.hold * 0.5, 1)).toBeCloseTo(BEND.depth, 9);
    expect(bendCurve(["bend"], 1, 1)).toBeCloseTo(1, 3);
    expect(bendCurve(["fall"], 0.3, 1)).toBe(1);
    expect(bendCurve(["fall"], 3, 1)).toBeCloseTo(FALL.depth, 3);
    // 单调：bend 一路往上，fall 一路往下
    for (let t = 0; t < 1; t += 0.05) {
      expect(bendCurve(["bend"], t + 0.05, 1)).toBeGreaterThanOrEqual(bendCurve(["bend"], t, 1) - 1e-12);
      expect(bendCurve(["fall"], t + 0.05, 1)).toBeLessThanOrEqual(bendCurve(["fall"], t, 1) + 1e-12);
    }
  });

  it("筝的后押与揉弦排在缓冲源的播放速率上；琵琶的长音轮指，每一下都按同一条弯音曲线接着走", () => {
    const { ctx, synth, dest, out } = setup();
    const koto = INSTRUMENTS.koto;
    if (koto.kind !== "pluck") throw new Error("koto");
    synth.pluckNote(note(0, 1.5, 62, ["bend", "vib"]), "koto", koto, dest, 1, out);
    const src = ctx.startedSources()[0];
    const ev = (src.playbackRate as FakeParam).events;
    expect(ev[0][0]).toBe("set");
    expect(ev[0][1]).toBeCloseTo(BEND.depth, 9);
    expect(ev.some((e) => e[0] === "target" && e[1] === 1 && Math.abs(e[2] - (1 + BEND.hold)) < 1e-9)).toBe(true);
    // 揉弦：一个约 5.6 Hz 的振荡器经过增益推着 playbackRate
    const pushers = feeding(ctx, src.playbackRate as FakeParam);
    expect(pushers.length).toBe(1);
    expect((pushers[0].gain as FakeParam).events.some((e) => e[0] === "target" && Math.abs(e[1] - PLUCK_VIB.depth) < 1e-12)).toBe(true);
    // 琵琶：1.2 秒的长音轮指，十几下，后面几下的弯音从曲线上接着走（不再从低一个全音起）
    const { ctx: c2, synth: s2, dest: d2, out: o2 } = setup();
    const pipa = INSTRUMENTS.pipa;
    if (pipa.kind !== "pluck") throw new Error("pipa");
    s2.pluckNote(note(0, 1.2, 62, ["bend"]), "pipa", pipa, d2, 0, o2);
    const hits = c2.startedSources();
    expect(hits.length).toBeGreaterThan(15);
    const first = (hits[0].playbackRate as FakeParam).events[0][1];
    const later = (hits[hits.length - 1].playbackRate as FakeParam).events[0][1];
    expect(first).toBeCloseTo(BEND.depth, 6);
    expect(later).toBeGreaterThan(0.99);
  });

  it("伽倻琴的弄弦（!vib!）按乐器自己的快慢与深浅排在播放速率上（比缺省的 PLUCK_VIB 慢、深）；没写 vib 的筝照旧用缺省", () => {
    const g = INSTRUMENTS.gayageum;
    if (g.kind !== "pluck" || !g.vib) throw new Error("gayageum");
    const { ctx, synth, dest, out } = setup();
    synth.pluckNote(note(0, 1.5, 64, ["vib"]), "gayageum", g, dest, 1, out);
    const src = ctx.startedSources()[0];
    const pushers = feeding(ctx, src.playbackRate as FakeParam);
    expect(pushers.length).toBe(1);
    const lfo = ctx.nodes.find((n) => n.kind === "oscillator" && n.outputs.includes(pushers[0]))!;
    expect((lfo.frequency as FakeParam).value).toBeCloseTo(g.vib.rate, 9);
    expect((pushers[0].gain as FakeParam).events.some((e) => e[0] === "target" && Math.abs(e[1] - g.vib!.depth) < 1e-12 && Math.abs(e[2] - (1 + g.vib!.delay)) < 1e-9)).toBe(true);
    expect(g.vib.rate).toBeLessThan(PLUCK_VIB.rate);
    expect(g.vib.depth).toBeGreaterThan(PLUCK_VIB.depth);
    // 筝没写 vib：照旧是 PLUCK_VIB
    const { ctx: c2, synth: s2, dest: d2, out: o2 } = setup();
    const koto = INSTRUMENTS.koto;
    if (koto.kind !== "pluck") throw new Error("koto");
    s2.pluckNote(note(0, 1.5, 62, ["vib"]), "koto", koto, d2, 1, o2);
    const p2 = feeding(c2, c2.startedSources()[0].playbackRate as FakeParam);
    const l2 = c2.nodes.find((n) => n.kind === "oscillator" && n.outputs.includes(p2[0]))!;
    expect((l2.frequency as FakeParam).value).toBeCloseTo(PLUCK_VIB.rate, 9);
  });

  it("ABC 认得 !bend! !fall! !vib!，展开后带在音符事件上", () => {
    const l = parseAbc("!bend!d2 !fall!e2 !vib!f4", parseKey("D major"));
    expect(l.notes.map((n) => n.deco)).toEqual([["bend"], ["fall"], ["vib"]]);
    const track: TrackDef = {
      id: "deco",
      title: { zh: "deco", en: "deco" },
      qpm: 100,
      meter: [4, 4],
      key: "D major",
      voices: { v: { inst: "shakuhachi" } },
      sections: { A: { bars: 1, lines: { m: "!bend!d2 !fall!e2 !vib!f4" } } },
      forms: [[{ s: "A", play: "m:v" }]],
      rest: [0, 0],
    };
    expect(realizePass(track, 0).events.map((e) => e.deco)).toEqual([["bend"], ["fall"], ["vib"]]);
  });
});
