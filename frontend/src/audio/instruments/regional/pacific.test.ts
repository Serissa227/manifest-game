// 太平洋的地方乐器与曲子（第九批配乐·地方特色第二阶段）：登记、每件乐器合成出来的声音的特征（频谱的“签名”），
// 《潟湖的鼓声》与重编的《星路》的调式、节奏型与配器；经典世界的曲子一件太平洋的乐器也不用。
// 通用的检查（确定、没有非数、峰值归一、音高准确、余音衰减、样本曲谱完整）由 regional.test.ts 对全部地方乐器逐件做，这里不重复。
import { describe, expect, it } from "vitest";
import { drum, mallet, pluck, type MalletSpec, type PluckSpec } from "../../dsp";
import { CORE_DRUMS, CORE_INSTRUMENTS, DRUMS, INSTRUMENTS, type SustainSpec } from "../../instruments";
import { ORCH_TRACKS } from "../../orchestra/tracks";
import { lineOf, realizePass, type TrackDef } from "../../score";
import { TRACKS, type TrackId } from "../../tracks";
import { REGIONAL, REGIONAL_INSTRUMENTS, regionalId } from ".";

const SR = 44100;
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

const PACIFIC = REGIONAL.filter((d) => d.region === "pacific");
const PACIFIC_KEYS = PACIFIC.flatMap((d) => (d.key ? [d.key] : []));
const PACIFIC_HITS = PACIFIC.flatMap((d) => Object.keys(d.drums ?? {}));

function sustain(key: string): SustainSpec {
  const i = INSTRUMENTS[key];
  if (!i || i.kind === "pluck" || i.kind === "mallet" || i.kind === "perc") throw new Error(key);
  return i;
}
function malletSpec(key: string): MalletSpec {
  const i = REGIONAL_INSTRUMENTS[key];
  if (!i || i.kind !== "mallet") throw new Error(key);
  return i.spec;
}
function pluckSpec(key: string): PluckSpec {
  const i = REGIONAL_INSTRUMENTS[key];
  if (!i || i.kind !== "pluck") throw new Error(key);
  return i.spec;
}
const hit = (name: string) => drum(DRUMS[name], SR, 1);

/** 某个频率在 [t0, t1) 秒里的功率（Goertzel，汉宁窗）。 */
function power(x: Float32Array, f: number, t0: number, t1: number): number {
  const a = Math.floor(t0 * SR);
  const b = Math.min(x.length, Math.floor(t1 * SR));
  const w = (2 * Math.PI * f) / SR;
  let re = 0,
    im = 0;
  for (let n = a; n < b; n++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * (n - a)) / (b - a));
    re += x[n] * h * Math.cos(w * n);
    im -= x[n] * h * Math.sin(w * n);
  }
  return (re * re + im * im) / ((b - a) * (b - a));
}

/** [t0, t1) 秒里功率最大的频率（lo–hi Hz 之间按 step Hz 扫）。 */
function peakFreq(x: Float32Array, t0: number, t1: number, lo: number, hi: number, step = 1): number {
  let best = 0;
  let at = lo;
  for (let f = lo; f <= hi; f += step) {
    const p = power(x, f, t0, t1);
    if (p > best) {
      best = p;
      at = f;
    }
  }
  return at;
}

/** 一阶低通把信号分成 f 以下与以上，返回 f 以下的能量比例（够区分“低频为主”“高频为主”）。 */
function lowShare(x: Float32Array, f: number): number {
  const a = 1 - Math.exp((-2 * Math.PI * f) / SR);
  let lp = 0,
    eLow = 0,
    eAll = 0;
  for (let n = 0; n < x.length; n++) {
    lp += a * (x[n] - lp);
    eLow += lp * lp;
    eAll += x[n] * x[n];
  }
  return eLow / eAll;
}

describe("太平洋的地方乐器：登记", () => {
  it("十六件：波利尼西亚、美拉尼西亚、密克罗尼西亚；键与鼓点名都对得上，不与原有的群岛乐器（pahu 大鼓、vivo 鼻笛）与玛雅的海螺号重名", () => {
    expect(PACIFIC.length).toBe(16);
    expect([...PACIFIC_KEYS].sort()).toEqual(["belembaotuyan", "kaekeeke", "ohe_hano", "pu", "ukeke"]);
    expect([...PACIFIC_HITS].sort()).toEqual(
      ["faatete", "faatete_rim", "garamut", "garamut_hi", "ilili", "ipu_ku", "ipu_pa", "kalaau", "kundu", "kundu_slap", "lali", "lali_meke", "pahu_nui", "pahu_pa", "pate", "pate_hi", "puniu", "uliuli", "uliuli_swish"].sort(),
    );
    for (const k of PACIFIC_KEYS) expect(Object.prototype.hasOwnProperty.call(CORE_INSTRUMENTS, k), k).toBe(false);
    for (const h of PACIFIC_HITS) expect(Object.prototype.hasOwnProperty.call(CORE_DRUMS, h), h).toBe(false);
    // 原有的群岛大鼓与鼻笛、玛雅的海螺号照旧在
    expect(CORE_DRUMS.pahu).toBeTruthy();
    expect(CORE_INSTRUMENTS.vivo).toBeTruthy();
    expect(REGIONAL_INSTRUMENTS.conch).toBeTruthy();
    expect(REGIONAL_INSTRUMENTS.pu).not.toBe(REGIONAL_INSTRUMENTS.conch);
    for (const d of PACIFIC) expect(regionalId(d).length, d.name.en).toBeGreaterThan(0);
  });
});

describe("太平洋的地方乐器：声音的特征", () => {
  it("帕胡鼓（鲨皮鼓）：低音在 80 Hz 上下、带鼓身的分音，比原有的群岛大鼓余音长得多；手指打的“帕”亮得多", () => {
    const nui = hit("pahu_nui");
    const f = peakFreq(nui, 0.15, 0.6, 50, 200);
    expect(f, `${f} Hz`).toBeGreaterThan(70);
    expect(f, `${f} Hz`).toBeLessThan(95);
    expect(power(nui, f * 1.47, 0.1, 0.5)).toBeGreaterThan(power(nui, f * 1.25, 0.1, 0.5) * 3);
    expect(nui.length).toBeGreaterThan(drum(CORE_DRUMS.pahu, SR, 1).length * 1.4);
    expect(lowShare(nui, 250)).toBeGreaterThan(0.7);
    expect(lowShare(hit("pahu_pa"), 250)).toBeLessThan(lowShare(nui, 250) * 0.6);
  });

  it("伊普双葫芦：顿下去的“库”是 125 Hz 上下的空响、很短；拍的“帕”亮得多", () => {
    const ku = hit("ipu_ku");
    const f = peakFreq(ku, 0.05, 0.25, 80, 250);
    expect(Math.abs(f - 125), `${f} Hz`).toBeLessThan(12);
    expect(ku.length / SR).toBeLessThan(0.6);
    expect(1 - lowShare(hit("ipu_pa"), 1000)).toBeGreaterThan((1 - lowShare(ku, 1000)) * 3);
  });

  it("普纽膝鼓高而短；伊利伊利卵石比卡拉阿乌节奏棒更高；乌利乌利羽毛沙铃几乎全在高频，甩的一下比摇的长", () => {
    const puniu = hit("puniu");
    expect(lowShare(puniu, 250)).toBeLessThan(0.3);
    expect(puniu.length / SR).toBeLessThan(0.5);
    const ilili = hit("ilili");
    const kalaau = hit("kalaau");
    expect(lowShare(ilili, 1000)).toBeLessThan(0.2);
    expect(lowShare(ilili, 1000)).toBeLessThan(lowShare(kalaau, 1000));
    expect(lowShare(kalaau, 500)).toBeLessThan(0.3);
    expect(lowShare(hit("uliuli"), 1500)).toBeLessThan(0.2);
    expect(hit("uliuli_swish").length).toBeGreaterThan(hit("uliuli").length);
  });

  it("裂缝鼓一族：帕特敲缝心约 735 Hz、两头更高；拉利低沉（约 130 Hz）、余音长，舞蹈拉利高；加拉穆特比拉利更低、更长", () => {
    const pate = hit("pate");
    const pateHi = hit("pate_hi");
    const fp = peakFreq(pate, 0.005, 0.08, 500, 1300, 2);
    expect(Math.abs(fp - 735), `${fp} Hz`).toBeLessThan(45);
    expect(peakFreq(pateHi, 0.005, 0.08, 500, 1300, 2)).toBeGreaterThan(fp * 1.25);
    const lali = hit("lali");
    const fl = peakFreq(lali, 0.1, 0.5, 80, 250);
    expect(Math.abs(fl - 132), `${fl} Hz`).toBeLessThan(12);
    expect(lali.length / SR).toBeGreaterThan(0.8);
    expect(lowShare(lali, 300)).toBeGreaterThan(0.6);
    expect(peakFreq(hit("lali_meke"), 0.02, 0.15, 250, 700)).toBeGreaterThan(fl * 2.5);
    const garamut = hit("garamut");
    expect(peakFreq(garamut, 0.15, 0.6, 50, 250)).toBeLessThan(fl * 0.85);
    expect(garamut.length).toBeGreaterThan(lali.length);
  });

  it("法阿特特小鼓（塔希提）：鼓心约 420 Hz、短（不到 0.5 秒），比帕胡鼓的“帕”高、比普纽膝鼓的余音长；敲鼓边更干、更亮", () => {
    const f = hit("faatete");
    const f0 = peakFreq(f, 0.01, 0.12, 300, 650);
    expect(Math.abs(f0 - 420), `${f0} Hz`).toBeLessThan(25);
    expect(f.length / SR).toBeLessThan(0.5);
    expect(lowShare(f, 250)).toBeLessThan(0.3);
    expect(f0).toBeGreaterThan(peakFreq(hit("pahu_pa"), 0.01, 0.12, 200, 650) * 1.25);
    expect(f.length).toBeGreaterThan(hit("puniu").length);
    const rim = hit("faatete_rim");
    expect(rim.length).toBeLessThan(f.length);
    expect(lowShare(rim, 1000)).toBeLessThan(lowShare(f, 1000));
  });

  it("昆杜沙漏鼓：鼓心“唱”的一声在 200 Hz 上下；拍边亮", () => {
    const k = hit("kundu");
    const f = peakFreq(k, 0.1, 0.35, 150, 300);
    expect(Math.abs(f - 198), `${f} Hz`).toBeLessThan(15);
    expect(lowShare(hit("kundu_slap"), 1000)).toBeLessThan(lowShare(k, 1000));
  });

  it("鼻笛（ʻohe hano ihu）：几乎是正弦，气声比原有的鼻笛 vivo 与木笛都重，起音软、没有吐音（鼻子吹不出“吐”）、音与音连着", () => {
    const s = sustain("ohe_hano");
    const vivo = sustain("vivo");
    const flute = sustain("flute");
    for (let n = 2; n <= 5; n++) expect(s.amps(n, n * 523) / s.amps(1, 523), `${n}`).toBeLessThan(0.15);
    const air = (x: SustainSpec) => (x.breath?.level ?? 0) + (x.pulse?.level ?? 0);
    expect(air(s)).toBeGreaterThan(air(vivo) * 2);
    expect(air(s)).toBeGreaterThan(air(flute) * 3);
    expect(s.chiff ?? 0).toBe(0);
    expect(s.attack).toBeGreaterThan(vivo.attack);
    expect(s.tongue ?? 0).toBeGreaterThanOrEqual(0.8);
  });

  it("普（波利尼西亚海螺号）：比玛雅的海螺号暗、起音更慢、音高晃得更多", () => {
    const pu = sustain("pu");
    const conch = sustain("conch");
    expect(pu.kind).toBe("brass");
    const bright = (x: SustainSpec, f0: number) => [6, 7, 8, 9, 10].reduce((a, n) => a + x.amps(n, n * f0) / x.amps(1, f0), 0);
    for (const f0 of [196, 220, 294]) expect(bright(pu, f0), `${f0}`).toBeLessThan(bright(conch, f0) * 0.5);
    expect(pu.attack).toBeGreaterThan(conch.attack);
    expect(pu.drift ?? 0).toBeGreaterThan(conch.drift ?? 0);
  });

  it("顿竹筒（卡埃克埃克）：闭管，三倍频远强于二倍频", () => {
    const f = hz(50);
    const x = mallet(malletSpec("kaekeeke"), f, SR, 3);
    expect(power(x, 3.02 * f, 0.03, 0.2)).toBeGreaterThan(power(x, 2 * f, 0.03, 0.2) * 10);
    expect(x.length / SR).toBeLessThan(1);
  });

  it("乌克克口弓：写的音（嘴腔选出的第四谐波）最响，下面两个八度的弦音也在", () => {
    const f = hz(74);
    const x = mallet(malletSpec("ukeke"), f, SR, 5);
    const main = power(x, f, 0.05, 0.4);
    for (const r of [0.25, 0.5, 0.75, 1.25, 1.5]) expect(main, `${r}`).toBeGreaterThan(power(x, f * r, 0.05, 0.4) * 2);
    expect(power(x, f / 4, 0.05, 0.4)).toBeGreaterThan(main * 0.02);
  });

  it("贝伦巴奥图延葫芦弓：葫芦腔的共鸣让 300 Hz 附近的谐波更响", () => {
    const spec = pluckSpec("belembaotuyan");
    const f = hz(43);
    const ratio = (s: PluckSpec) => {
      const x = pluck(s, f, SR, 4);
      return power(x, 3 * f, 0.05, 0.4) / power(x, f, 0.05, 0.4);
    };
    expect(ratio(spec)).toBeGreaterThan(ratio({ ...spec, body: undefined }) * 2);
  });
});

/** 一首曲子每一遍里某些声部奏到的音高类（0–11）。 */
function pitchClasses(track: TrackDef, voices: readonly string[]): Set<number> {
  const out = new Set<number>();
  for (let pass = 0; pass < track.forms.length; pass++) {
    for (const e of realizePass(track, pass).events) if (voices.includes(e.voice) && !e.hit) out.add(((Math.round(e.m) % 12) + 12) % 12);
  }
  return out;
}

/** 段落里写的和弦都是空五度（X5）：不写西洋的三和弦。 */
function onlyFifths(track: TrackDef): string[] {
  const bad: string[] = [];
  for (const [name, s] of Object.entries(track.sections)) {
    for (const sym of (s.chords ?? "").split(/[|\s]+/).filter(Boolean)) if (!/^[A-G][#b]?5(\*\d+)?$/.test(sym)) bad.push(`${name}: ${sym}`);
  }
  return bad;
}

/** 曲式里用到的旋律声部（“旋律行:声部”）。 */
function melodicVoices(track: TrackDef): Set<string> {
  const out = new Set<string>();
  for (const form of track.forms) for (const st of form) for (const tok of st.play.split(/\s+/)) if (tok.includes(":")) out.add(tok.split(":")[1].replace(/[+~-].*$/, ""));
  return out;
}

describe("《潟湖的鼓声》port_polynesia", () => {
  const synth = TRACKS.port_polynesia;
  const orch = ORCH_TRACKS.port_polynesia;

  it("太平洋的乐器领奏：旋律声部全是太平洋的乐器；两套编配同一份地方乐器的声部", () => {
    for (const v of melodicVoices(synth)) expect(PACIFIC_KEYS, v).toContain(synth.voices[v].inst);
    for (const k of ["ohe_hano", "pu", "ukeke", "kaekeeke"]) expect(Object.values(synth.voices).some((v) => v.inst === k), k).toBe(true);
    for (const v of ["flute", "pu", "ukeke", "tubes", "ipu", "pate1", "pate2", "pahu", "faatete"]) expect(orch.voices[v]).toBe(synth.voices[v]);
  });

  it("调式：D 上的无半音的几个音（D E G A C），不用 F 与 B；和声只有空五度", () => {
    const pcs = pitchClasses(synth, ["flute", "pu", "ukeke", "tubes"]);
    for (const pc of pcs) expect([2, 4, 7, 9, 0], `${pc}`).toContain(pc);
    expect(onlyFifths(synth)).toEqual([]);
  });

  it("节奏型：伊普打 kāholo（库 · 帕帕）；奥特阿的两只裂缝鼓咬合成不停的十六分音符、从不同时敲；第一遍奥特阿的法阿特特只敲 3 + 3 + 2 的重音；奥特阿快 1.25 倍", () => {
    const ipu = synth.voices.ipu.pattern;
    expect(ipu && "kind" in ipu && ipu.kind === "drum" && ipu.steps.startsWith("K.PPK.PP")).toBe(true);
    const cells = (v: string, variant: string) => {
      const p = synth.voices[v].pattern as Record<string, { steps: string }>;
      return [...p[variant].steps].map((c) => c !== ".");
    };
    const a = cells("pate1", "b");
    const b = cells("pate2", "b");
    expect(a.length).toBe(16);
    expect(b.length).toBe(16);
    for (let i = 0; i < 16; i++) expect(a[i] !== b[i], `第 ${i} 格`).toBe(true);
    // 十六分音符的格子：重音（F）在 0、6、12，重音之间只敲鼓边（r）
    const b1 = (synth.voices.faatete.pattern as Record<string, { steps: string }>).b1.steps;
    expect([...b1].map((c, i) => (c === "F" ? i : -1)).filter((i) => i >= 0)).toEqual([0, 6, 12]);
    expect([...b1].filter((c) => c !== "." && c !== "F" && c !== "r")).toEqual([]);
    for (const form of synth.forms) for (const st of form) if (st.s === "B" || st.s === "coda") expect(st.tempo).toBe(1.25);
  });

  it("每一遍 50–110 秒", () => {
    for (let pass = 0; pass < synth.forms.length; pass++) {
      const len = realizePass(synth, pass).length;
      expect(len).toBeGreaterThan(50);
      expect(len).toBeLessThan(110);
    }
  });

  it("鼻笛只有两三个孔：两遍里只吹相邻的四个音 D4 E4 G4 A4（不超过五度）；A 段高处的那一句（c d）由口弓答", () => {
    const notes = new Set<number>();
    for (let pass = 0; pass < synth.forms.length; pass++) for (const e of realizePass(synth, pass).events) if (e.voice === "flute" && !e.hit) notes.add(Math.round(e.m));
    expect([...notes].sort((a, b) => a - b)).toEqual([62, 64, 67, 69]);
    // A 段第五、六小节（第 32–48 个八分音符）：鼻笛歇着，口弓奏到 C5 与 D5
    const bar = 8;
    const inBars56 = (line: string) => lineOf(synth, "A", line).notes.filter((n) => n.at >= 4 * bar && n.at < 6 * bar);
    expect(inBars56("mel")).toEqual([]);
    const uk = new Set(inBars56("uk").flatMap((n) => n.pitches.map((m) => Math.round(m))));
    expect(uk.has(72) && uk.has(74)).toBe(true);
  });

  it("用这首的是塔希提与关岛（查莫罗）：第二遍夜里的 C 段有查莫罗的葫芦弓，奥特阿与尾声有塔希提的法阿特特；两套编配共用，葫芦弓也守调式；数据里没有美拉尼西亚与斐济、汤加的港口，不用昆杜与拉利", () => {
    const [p1, p2] = [0, 1].map((pass) => realizePass(synth, pass).events);
    expect(p2.some((e) => !e.hit && synth.voices[e.voice].inst === "belembaotuyan")).toBe(true);
    for (const events of [p1, p2]) expect(events.some((e) => e.hit === "faatete")).toBe(true);
    for (const events of [p1, p2]) expect(events.some((e) => e.hit === "kundu" || e.hit === "kundu_slap" || e.hit === "lali" || e.hit === "lali_meke")).toBe(false);
    for (const v of ["bow", "faatete"]) expect(orch.voices[v], v).toBe(synth.voices[v]);
    for (const pc of pitchClasses(synth, ["bow"])) expect([2, 4, 7, 9, 0], `${pc}`).toContain(pc);
    // 带普的那一遍：法阿特特八分音符不停，重音（F）仍落在 3 + 3 + 2 上（十六分音符的格子：0、6、12）
    const ft = (synth.voices.faatete.pattern as Record<string, { steps: string }>).b;
    expect([...ft.steps].map((c, i) => (c === "F" ? i : -1)).filter((i) => i >= 0)).toEqual([0, 6, 12]);
  });
});

describe("《星路》sea_pacific 重编", () => {
  const synth = TRACKS.sea_pacific;
  const orch = ORCH_TRACKS.sea_pacific;

  it("太平洋的乐器领奏（星是钢片琴 / 钟琴，算衬底）；两套编配同一份地方乐器的声部", () => {
    for (const v of melodicVoices(synth)) if (v !== "celesta") expect(PACIFIC_KEYS, v).toContain(synth.voices[v].inst);
    for (const v of ["flute", "pu", "ukeke", "bow", "pahu", "kalaau", "garamut"]) expect(orch.voices[v]).toBe(synth.voices[v]);
    // 起帆动机（G → C → G）的写法不变（由谁奏见下一项）
    expect(synth.sections.intro.lines?.motif).toMatch(/G,3\/2 C\/2 \| !fall!G8/);
  });

  it("普（海螺号）基本只有一个音：两遍里只吹 G3，只在 B 段吹上去五度到 D4 呼应；起帆动机交给口弓高八度拨（G4 C5 G5），鼻笛接住最后的 G5", () => {
    const pu = new Set<number>();
    for (let pass = 0; pass < synth.forms.length; pass++) for (const e of realizePass(synth, pass).events) if (e.voice === "pu" && !e.hit) pu.add(Math.round(e.m));
    expect([...pu].sort((a, b) => a - b)).toEqual([55, 62]);
    const high = new Set<string>();
    for (const form of synth.forms) for (const st of form) for (const tok of st.play.split(/\s+/)) if (tok.endsWith(":pu")) {
      for (const n of lineOf(synth, st.s, tok.split(":")[0]).notes) for (const m of n.pitches) if (Math.round(m) !== 55) high.add(st.s);
    }
    expect([...high]).toEqual(["B"]);
    for (const form of synth.forms) {
      const intro = form.find((st) => st.s === "intro");
      expect(intro?.play.split(/\s+/)).toEqual(expect.arrayContaining(["call:pu", "motif:ukeke+12", "hold:flute+12"]));
      expect(intro?.play).not.toMatch(/motif:pu/);
    }
  });

  it("第二遍的第一个 A（守夜）：只有口弓、葫芦弓与星，弦乐都歇着（领奏只是拨弦，衬底不能和它一样响）", () => {
    for (const track of [synth, orch]) {
      const night = track.forms[1].find((st) => st.s === "A");
      const toks = night?.play.split(/\s+/) ?? [];
      expect(toks).toEqual(expect.arrayContaining(["uk:ukeke+12", "dr:bow"]));
      for (const t of toks) {
        const v = t.includes(":") ? t.split(":")[1].replace(/[+~-].*$/, "") : t.split(".")[0];
        expect(["strings", "o.vn", "o.va", "o.vc", "o.cb"], `${track === orch ? "orch" : "synth"} ${t}`).not.toContain(track.voices[v].inst);
      }
    }
  });

  it("吟诵与应答只用 C D E G A；和声只有空五度", () => {
    const pcs = pitchClasses(synth, ["flute", "pu", "ukeke", "bow"]);
    for (const pc of pcs) expect([0, 2, 4, 7, 9], `${pc}`).toContain(pc);
    expect(onlyFifths(synth)).toEqual([]);
  });

  it("鼻笛只有两三个孔：两遍里只吹 C5 D5 E5 G5 四个音（不超过五度）；星（钢片琴 / 钟琴）也守着无半音的五个音", () => {
    const notes = new Set<number>();
    for (let pass = 0; pass < synth.forms.length; pass++) for (const e of realizePass(synth, pass).events) if (e.voice === "flute" && !e.hit) notes.add(Math.round(e.m));
    expect([...notes].sort((a, b) => a - b)).toEqual([72, 74, 76, 79]);
    const stars = pitchClasses(synth, ["celesta"]);
    expect(stars.size).toBeGreaterThan(0);
    for (const pc of stars) expect([0, 2, 4, 7, 9], `${pc}`).toContain(pc);
  });
});

describe("经典世界的曲子不用太平洋的乐器（一采样都不变）", () => {
  const CLASSIC: readonly TrackId[] = ["title", "sea", "sea_north", "sea_south", "sea_islands", "sea_east", "sea_new", "ocean", "storm", "port_mediterranean", "port_nordic", "port_lowland", "port_desert", "port_islands", "port_eastern", "port_frontier", "battle"];
  for (const id of CLASSIC) {
    it(id, () => {
      for (const track of [TRACKS[id], ORCH_TRACKS[id]]) {
        if (!track) continue;
        for (const [name, v] of Object.entries(track.voices)) {
          expect(PACIFIC_KEYS, `${id} ${name}`).not.toContain(v.inst);
          const pats = v.pattern ? ("kind" in v.pattern ? [v.pattern] : Object.values(v.pattern)) : [];
          for (const p of pats) if (p.kind === "drum") for (const [h] of Object.values(p.hits)) expect(PACIFIC_HITS, `${id} ${name}`).not.toContain(h);
        }
      }
    });
  }
});
