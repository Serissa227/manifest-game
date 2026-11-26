// 地方乐器第二阶段·印度在音频引擎里的发声（假的 Web Audio）：
// 维纳琴的 !vib! 按乐器自己的揉弦（kampita：宽而慢）排到缓冲源的播放速率上，没写的乐器照旧按 PLUCK_VIB；
// 单边的 kampita（维纳琴的 pluckVib.lift、纳达斯瓦拉姆的 vibLift）与拉格的 andolan（!andolan!：拨弦、弓弦、吹奏都按 ANDOLAN 一样慢，
// 也是单边的——缺省从记谱音往下摆，!andolan-up! 往上摆）；
// 萨朗吉的乐句旁边并着一排很窄的带通（共鸣弦），每根弦一个、中心是它的音高，合到一个增益再进声部；没有共鸣弦的弓弦乐器不接。
// 停在印度诸国的港口时按势力细分港口曲（莫卧儿 → 宫廷、卡利卡特 → 马拉巴尔），别的印度势力与经典世界照旧。
import { describe, expect, it } from "vitest";
import { parseAbc } from "../audio/abc";
import { sceneOf } from "../audio/director";
import { ANDOLAN, andolanDir, PLUCK_VIB, Synth } from "../audio/engine";
import { INSTRUMENTS, type SustainSpec } from "../audio/instruments";
import { realizePass, type NoteEvent, type TrackDef } from "../audio/score";
import { parseKey } from "../audio/theory";
import type { StaticView } from "../ipc/types";
import { FakeAudioContext, type FakeNode, type FakeParam } from "./fakeAudio";
import { overview, statics } from "./fixtures";

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function setup() {
  const ctx = new FakeAudioContext({ sampleRate: 44100 });
  const synth = new Synth(ctx as unknown as BaseAudioContext);
  const dest = ctx.createGain();
  const out = new Set<AudioScheduledSourceNode>();
  return { ctx, synth, dest, out };
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

/** 揉弦：推着这个缓冲源播放速率的低频振荡器的频率与深度。 */
function vibOf(ctx: FakeAudioContext, src: FakeNode): { rate: number; depth: number } {
  const pushers = feeding(ctx, src.playbackRate as FakeParam);
  expect(pushers.length).toBe(1);
  const depthGain = pushers[0];
  const lfo = ctx.nodes.find((n) => n.kind === "oscillator" && n.outputs.includes(depthGain))!;
  const target = (depthGain.gain as FakeParam).events.find((e) => e[0] === "target")!;
  return { rate: (lfo.frequency as FakeParam).value, depth: target[1] };
}

describe("拨弦的揉弦：乐器自己的 kampita / andolan", () => {
  it("萨拉斯瓦蒂维纳琴的 !vib! 按它的 pluckVib（宽而慢），鲁德拉维纳琴更慢；西塔琴没写，照旧按 PLUCK_VIB", () => {
    for (const [id, want] of [
      ["saraswati_veena", (INSTRUMENTS.saraswati_veena as { pluckVib?: { rate: number; depth: number } }).pluckVib!],
      ["rudra_veena", (INSTRUMENTS.rudra_veena as { pluckVib?: { rate: number; depth: number } }).pluckVib!],
      ["sitar", PLUCK_VIB],
    ] as const) {
      const { ctx, synth, dest, out } = setup();
      const inst = INSTRUMENTS[id];
      if (inst.kind !== "pluck") throw new Error(id);
      synth.pluckNote(note(0, 1.5, 52, ["vib"]), id, inst, dest as unknown as AudioNode, 1, out);
      const src = ctx.startedSources()[0];
      const got = vibOf(ctx, src);
      expect(got.rate, id).toBeCloseTo(want.rate, 9);
      expect(got.depth, id).toBeCloseTo(want.depth, 9);
    }
  });

  it("没写 !vib! 的音不接揉弦（推上来的 !bend! 照旧排在播放速率上）", () => {
    const { ctx, synth, dest, out } = setup();
    const inst = INSTRUMENTS.saraswati_veena;
    if (inst.kind !== "pluck") throw new Error("veena");
    synth.pluckNote(note(0, 1, 57, ["bend"]), "saraswati_veena", inst, dest as unknown as AudioNode, 0, out);
    const src = ctx.startedSources()[0];
    expect(feeding(ctx, src.playbackRate as FakeParam).length).toBe(0);
    expect((src.playbackRate as FakeParam).events.length).toBeGreaterThan(0);
  });
});

describe("单边的 kampita 与拉格的 andolan", () => {
  /** 拨一个音，返回它的缓冲源。 */
  const pluckOne = (id: string, deco: string[]) => {
    const { ctx, synth, dest, out } = setup();
    const inst = INSTRUMENTS[id];
    if (inst.kind !== "pluck") throw new Error(id);
    synth.pluckNote(note(0, 1.5, 52, deco), id, inst, dest as unknown as AudioNode, 1, out);
    return { ctx, src: ctx.startedSources()[0] };
  };

  it("“!andolan!”解析成 vib 与 andolan 两个装饰（它是一种揉），展开后的音符也带着两个", () => {
    const l = parseAbc("C !andolan!E2", parseKey("C minor"));
    expect(l.notes[1].deco).toEqual(["vib", "andolan"]);
    expect(l.notes[0].deco).toEqual([]);
  });

  it("“!andolan-up!”解析成 vib、andolan、up 三个装饰（往上摆的 andolan），展开成音符事件时 up 也带着", () => {
    const l = parseAbc("E !andolan-up!^F2", parseKey("E mixolydian"));
    expect(l.notes[1].deco).toEqual(["vib", "andolan", "up"]);
    const t: TrackDef = {
      id: "t",
      title: { zh: "t", en: "t" },
      qpm: 96,
      meter: [6, 8],
      key: "E mixolydian",
      voices: { v: { inst: "sarangi", gain: 0.5, pan: 0, reverb: 0.2 } },
      sections: { A: { bars: 1, chords: "E5", lines: { m: "E2 !andolan-up!F4" } } },
      forms: [[{ s: "A", play: "m:v", dyn: 0.7 }]],
      rest: [0, 0],
    };
    const ev = realizePass(t, 0).events.filter((e) => e.voice === "v");
    expect(ev.map((e) => e.deco ?? [])).toEqual([[], ["vib", "andolan", "up"]]);
    expect(andolanDir(ev[1].deco)).toBe(1);
    expect(andolanDir(["vib", "andolan"])).toBe(-1);
  });

  it("萨拉斯瓦蒂维纳琴的 kampita 从记谱音往上摆：播放速率的中心随深度升到 1 + depth（摆动 ±depth，最低不低于记谱音）；西塔琴、鲁德拉维纳琴照旧以记谱音为中心", () => {
    const pv = (INSTRUMENTS.saraswati_veena as { pluckVib?: { depth: number; lift?: number } }).pluckVib!;
    expect(pv.lift).toBe(1);
    const veena = pluckOne("saraswati_veena", ["vib"]);
    const ev = (veena.src.playbackRate as FakeParam).events;
    expect(ev.length).toBe(1);
    expect(ev[0][0]).toBe("target");
    expect(ev[0][1]).toBeCloseTo(1 + pv.depth, 9);
    expect(vibOf(veena.ctx, veena.src).depth).toBeCloseTo(pv.depth, 9);
    for (const id of ["sitar", "rudra_veena"]) expect((pluckOne(id, ["vib"]).src.playbackRate as FakeParam).events.length, id).toBe(0);
  });

  it("拨弦的 !andolan!：哪件拨弦乐器都按 ANDOLAN 慢摇（每秒一两下、摆幅约 ±32 音分），不看乐器自己的揉弦；中心往下偏一个摆幅（记谱音是上端），带 up 往上偏（记谱音是下端）", () => {
    expect(ANDOLAN.rate).toBeGreaterThan(1);
    expect(ANDOLAN.rate).toBeLessThan(2);
    // 拉巴卜的键整合时改成 seni_rabab（与马格里布的 rabab 重名）
    for (const id of ["rudra_veena", "saraswati_veena", "seni_rabab", "sitar"]) {
      for (const [deco, dir] of [[["vib", "andolan"], -1], [["vib", "andolan", "up"], 1]] as const) {
        const { ctx, src } = pluckOne(id, [...deco]);
        const got = vibOf(ctx, src);
        expect(got.rate, id).toBeCloseTo(ANDOLAN.rate, 9);
        expect(1200 * Math.log2(1 + got.depth), id).toBeCloseTo(ANDOLAN.depth, 6);
        // 播放速率的中心：与摆幅同时（音符在第 1 秒开始，ANDOLAN.delay 秒后、时间常数 ANDOLAN.tc）偏到 1 ± 摆幅（往下摆为 1 − 摆幅）
        const ev = (src.playbackRate as FakeParam).events;
        expect(ev.length, `${id} ${dir}`).toBe(1);
        expect(ev[0][0]).toBe("target");
        expect(ev[0][1], `${id} ${dir}`).toBeCloseTo(1 + dir * got.depth, 12);
        expect(ev[0][2], `${id} ${dir}`).toBeCloseTo(1 + ANDOLAN.delay, 12);
        // 摆到的最高、最低：往下摆时最高正好是记谱音、最低约 −64 音分；往上摆时反过来
        const hi = 1200 * Math.log2(ev[0][1] + got.depth);
        const lo = 1200 * Math.log2(ev[0][1] - got.depth);
        if (dir < 0) {
          expect(hi, id).toBeCloseTo(0, 9);
          expect(lo, id).toBeLessThan(-60);
        } else {
          expect(lo, id).toBeCloseTo(0, 9);
          expect(hi, id).toBeGreaterThan(60);
        }
      }
    }
  });

  /** 一个乐句里推着振荡器 detune 的揉音振荡器（低频振荡器 → 深度增益（逐音自动化）→ 某个振荡器的 detune；音高慢漂的增益是固定的，不算）。 */
  const vibLfos = (ctx: FakeAudioContext) => {
    const detunes = new Set(ctx.nodes.filter((n) => n.kind === "oscillator").map((n) => n.detune as unknown as FakeNode));
    return ctx.nodes.filter(
      (n) => n.kind === "oscillator" && n.outputs.some((g) => (g.gain as FakeParam | undefined)?.events.length && (g.outputs ?? []).some((p) => detunes.has(p))),
    );
  };

  it("弓弦 / 吹奏的 !andolan!：萨朗吉与谢赫奈在这个音上把揉音换成 ANDOLAN 的速度与深度，下一个音换回自己的；没有 andolan 的乐句不动揉音的速度", () => {
    for (const id of ["sarangi", "shehnai"]) {
      const { ctx, synth, dest, out } = setup();
      const spec = sustain(id);
      synth.phrase([note(1, 0.8, 60), note(1.8, 1.5, 63, ["vib", "andolan"], true), note(3.3, 1, 62)], id, spec, dest as unknown as AudioNode, 0, out);
      const lfos = vibLfos(ctx);
      expect(lfos.length, id).toBeGreaterThan(0);
      for (const lfo of lfos) {
        const ev = (lfo.frequency as FakeParam).events;
        expect(ev, id).toEqual([
          ["set", ANDOLAN.rate, 1.8],
          ["set", spec.vib!.rate, 3.3],
        ]);
        const depth = lfo.outputs[0].gain as FakeParam;
        expect(depth.events.some((e) => e[0] === "target" && e[1] === ANDOLAN.depth && Math.abs(e[2] - (1.8 + ANDOLAN.delay)) < 1e-9), id).toBe(true);
      }
    }
    // 没有 andolan：揉音振荡器的速度一个事件也没有（经典与第一阶段的乐器照旧）
    const { ctx, synth, dest, out } = setup();
    synth.phrase([note(1, 0.8, 60), note(1.8, 1.5, 63, ["vib"], true)], "sarangi", sustain("sarangi"), dest as unknown as AudioNode, 0, out);
    for (const lfo of vibLfos(ctx)) expect((lfo.frequency as FakeParam).events).toEqual([]);
  });

  it("弓弦 / 吹奏的 !andolan!：音高的中心随摆幅一起偏 ANDOLAN.depth 音分（缺省往下、带 up 往上），记谱音是摆动的一端；太短的音不偏", () => {
    for (const id of ["sarangi", "shehnai"]) {
      for (const dir of [-1, 1] as const) {
        const { ctx, synth, dest, out } = setup();
        const deco = dir < 0 ? ["vib", "andolan"] : ["vib", "andolan", "up"];
        synth.phrase([note(1, 0.8, 60), note(1.8, 1.5, 63, deco, true), note(3.3, 0.2, 62, deco)], id, sustain(id), dest as unknown as AudioNode, 0, out);
        const main = ctx.nodes.find((n) => n.kind === "oscillator" && (n.frequency as FakeParam).events.length > 0)!;
        const targets = (main.frequency as FakeParam).events.filter((e) => e[0] === "target" && Math.abs(e[2] - (1.8 + ANDOLAN.delay)) < 1e-9);
        expect(targets.length, `${id} ${dir}`).toBe(1);
        expect(targets[0][1], `${id} ${dir}`).toBeCloseTo(hz(63) * Math.pow(2, (dir * ANDOLAN.depth) / 1200), 6);
        // 0.2 秒的音来不及摇：不偏（也不加摆幅）
        expect((main.frequency as FakeParam).events.some((e) => e[0] === "target" && Math.abs(e[2] - (3.3 + ANDOLAN.delay)) < 1e-9), `${id} ${dir}`).toBe(false);
      }
    }
  });

  it("纳达斯瓦拉姆的 kampita（!vib!）从记谱音往上摆：音高的中心随深揉一起升 vibLift × 深度；谢赫奈没写 vibLift，照旧以记谱音为中心", () => {
    const pitchTargets = (id: string) => {
      const { ctx, synth, dest, out } = setup();
      synth.phrase([note(1, 1.5, 64, ["vib"])], id, sustain(id), dest as unknown as AudioNode, 0, out);
      const main = ctx.nodes.find((n) => n.kind === "oscillator" && (n.frequency as FakeParam).events.length > 0)!;
      return (main.frequency as FakeParam).events.filter((e) => e[0] === "target");
    };
    const n = sustain("nadaswaram");
    expect(n.vibLift).toBe(1);
    const lift = n.vib!.depth * (n.vibBoost ?? 2.2);
    const got = pitchTargets("nadaswaram");
    expect(got.length).toBe(1);
    expect(got[0][1]).toBeCloseTo(hz(64) * Math.pow(2, lift / 1200), 6);
    expect(got[0][2]).toBeCloseTo(1 + n.vib!.delay, 9);
    expect(pitchTargets("shehnai")).toEqual([]);
  });
});

describe("萨朗吉的共鸣弦", () => {
  it("乐句的声音同时送进一排带通：每根共鸣弦一个（中心是它的音高、Q 很高），合到一个增益（共鸣弦的音量）再进声部", () => {
    const { ctx, synth, dest, out } = setup();
    const spec = sustain("sarangi");
    const sym = spec.sympathetic!;
    synth.phrase([note(1, 1.2, 60), note(2.2, 1.5, 63, ["vib"], false)], "sarangi", spec, dest as unknown as AudioNode, 0, out);
    const bands = ctx.nodes.filter((n) => n.kind === "biquad" && n.type === "bandpass" && (n.Q as FakeParam).value === sym.q);
    expect(bands.length).toBe(sym.notes.length);
    const freqs = bands.map((b) => (b.frequency as FakeParam).value).sort((a, b) => a - b);
    const want = [...sym.notes].map(hz).sort((a, b) => a - b);
    freqs.forEach((f, i) => expect(f).toBeCloseTo(want[i], 6));
    // 都合到同一个增益（音量 = level），这个增益接到声部上
    const sum = bands[0].outputs[0];
    expect(bands.every((b) => b.outputs.length === 1 && b.outputs[0] === sum)).toBe(true);
    expect((sum.gain as FakeParam).value).toBeCloseTo(sym.level, 9);
    expect(sum.outputs).toContain(dest);
    // 每个带通都由乐句的声音（同一个节点）推着
    const feeders = new Set(ctx.nodes.filter((n) => bands.some((b) => n.outputs.includes(b))));
    expect(feeders.size).toBe(1);
  });

  it("没有共鸣弦的弓弦乐器（二胡）不接这一排带通", () => {
    const { ctx, synth, dest, out } = setup();
    synth.phrase([note(1, 1.2, 62)], "erhu", sustain("erhu"), dest as unknown as AudioNode, 0, out);
    expect(ctx.nodes.filter((n) => n.kind === "biquad" && n.type === "bandpass" && (n.Q as FakeParam).value > 50).length).toBe(0);
  });
});

describe("停在印度诸国的港口：按势力写的风格名细分港口曲", () => {
  const withFaction = (key: string, style: string | null): StaticView => ({ ...statics, factions: statics.factions.map((f, i) => (i === 0 ? { ...f, key, style } : f)) });
  const docked = { ...overview, fleets: [{ ...overview.fleets[0], docked: 0 }] };

  it("莫卧儿与德干的苏丹国 → 《红砂岩的宫廷》，维查耶纳伽尔、卡利卡特、科钦、锡兰 → 《豆蔻山下的港》，古吉拉特与孟加拉照旧是 port_india（《棉布与靛蓝的码头》）", () => {
    // 配乐的数据接线（2026-10-11）：原来这些势力都写 indian、由前端按势力 key 细分；现在带着数据里写的细名（见 DECISIONS“测试期望值变更”）
    for (const [k, s] of [["mughal", "mughal"], ["sur", "hindustani"], ["bijapur", "deccan"], ["golconda", "deccan"]] as const) expect(sceneOf(true, withFaction(k, s), docked).track, k).toBe("port_mughal");
    for (const [k, s] of [["vijayanagara", "carnatic"], ["calicut", "malabar"], ["cochin", "malabar"], ["kotte", "sinhalese"], ["kandy", "sinhalese"]] as const) {
      expect(sceneOf(true, withFaction(k, s), docked).track, k).toBe("port_malabar");
    }
    for (const k of ["gujarat", "bengal"]) expect(sceneOf(true, withFaction(k, "indian"), docked).track, k).toBe("port_india");
    // 不认势力 key：写 indian 的卡利卡特、莫卧儿就是《棉布与靛蓝的码头》
    for (const k of ["calicut", "mughal"]) expect(sceneOf(true, withFaction(k, "indian"), docked).track, k).toBe("port_india");
  });

  it("风格名写得更细时按风格名；任何风格都不看势力 key", () => {
    expect(sceneOf(true, withFaction("gujarat", "mughal"), docked).track).toBe("port_mughal");
    expect(sceneOf(true, withFaction("bengal", "malabar"), docked).track).toBe("port_malabar");
    // 莫卧儿的 key 配上葡萄牙的风格（假想）：按风格走（整合后 iberian 有了伊比利亚的《橙花码头》，原来回退到地中海，见 DECISIONS“测试期望值变更”）
    expect(sceneOf(true, withFaction("mughal", "iberian"), docked).track).toBe("port_iberia");
  });
});
