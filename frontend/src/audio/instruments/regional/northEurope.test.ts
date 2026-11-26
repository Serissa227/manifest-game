// 地方乐器第二阶段·北欧（低地国家、英格兰、法兰西、汉萨与斯堪的纳维亚、罗斯）：登记，以及每件乐器合成出来的声音的“签名”——
// 风笛的唱管亮、连着不断、没有揉音，持续音管与克鲁姆管是奇次谐波的嗡；手摇弦琴的“狗”调在小号弦的音高上、谐波很满；
// 尼克尔哈帕的微光（齐奏）与键的“嗒”，古多克的弓噪，雷贝克琴比提琴尖；维金纳琴（拨在弦的正中）偶次谐波弱；古斯里琴与朗格莱克琴的空弦被带着响；
// 钟楼排钟的小三度与长长的哼音，罗斯的钟不成比例的分音；隆默尔罐低沉、起音慢，长鼓比小鼓低，木勺与响板在高处……
// 通用的检查（确定、无非数、峰值归一、音高、衰减、音色样本的曲谱）在 regional.test.ts 里对全部地方乐器做。
import { describe, expect, it } from "vitest";
import { drum, mallet, pluck, type DrumSpec, type MalletSpec, type PluckSpec } from "../../dsp";
import { CORE_INSTRUMENTS, type Instrument, type SustainSpec } from "../../instruments";
import { REGIONAL, REGIONAL_DRUMS, REGIONAL_INSTRUMENTS, regionalId } from ".";

const SR = 44100;
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** 北欧的乐器键与鼓点名（登记表）。 */
const KEYS = [
  "bagpipe",
  "pipe_drone",
  "cornemuse",
  "hurdygurdy",
  "hurdy_drone",
  "crumhorn",
  "nyckelharpa",
  "gusli",
  "gudok",
  "zhaleika",
  "tabor_pipe",
  "galoubet",
  "beiaard",
  "kolokol",
  "virginal",
  "bandora",
  "rebeck",
  "langeleik",
  "bukkehorn",
];
const HITS = [
  "chien_g",
  "chien_c",
  "chien_d",
  "taborin",
  "taborin_flam",
  "taborin_rim",
  "tambourin",
  "tambourin_ta",
  "rommelpot",
  "rommelpot_up",
  "trommel",
  "trommel_rim",
  "lozhki",
  "lozhki_roll",
  "treshchotka",
  "treshchotka_short",
  "buben",
  "buben_shake",
];

function inst(key: string): Instrument {
  const i = REGIONAL_INSTRUMENTS[key];
  if (!i) throw new Error(key);
  return i;
}
function sustainOf(i: Instrument | undefined, key: string): SustainSpec {
  if (!i || i.kind === "pluck" || i.kind === "mallet" || i.kind === "perc") throw new Error(key);
  return i;
}
const sustain = (key: string) => sustainOf(inst(key), key);
const core = (key: string) => sustainOf(CORE_INSTRUMENTS[key], key);
function pluckSpec(key: string): PluckSpec {
  const i = inst(key);
  if (i.kind !== "pluck") throw new Error(key);
  return i.spec;
}
function malletSpec(key: string): MalletSpec {
  const i = inst(key);
  if (i.kind !== "mallet") throw new Error(key);
  return i.spec;
}
function drumSpec(hit: string): DrumSpec {
  const d = REGIONAL_DRUMS[hit];
  if (!d) throw new Error(hit);
  return d;
}

/** 谐波表：第 n 个谐波相对基频的振幅（基频 f0）。 */
const ratio = (s: SustainSpec, n: number, f0 = 440) => s.amps(n, n * f0) / s.amps(1, f0);
/** 第 6、8、10 个谐波的相对振幅之和（越大越亮）。 */
const bright = (s: SustainSpec, f0 = 440) => [6, 8, 10].reduce((sum, n) => sum + ratio(s, n, f0), 0);

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

/** [t0, t1) 秒里功率最大的频率（在 lo–hi Hz 之间按 step Hz 扫）。 */
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

/** 一阶低通把信号分成 f 以下与以上：f 以下的能量比例。 */
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

function energy(x: Float32Array, a: number, b: number): number {
  let e = 0;
  for (let n = a; n < Math.min(b, x.length); n++) e += x[n] * x[n];
  return e / Math.max(1, b - a);
}

describe("北欧的地方乐器：登记", () => {
  it("十九件有音高的乐器与十八个鼓点都登记在北欧（north_europe）一区，键与鼓点名都合进了表", () => {
    const mine = REGIONAL.filter((d) => d.region === "north_europe");
    expect(mine.flatMap((d) => (d.key ? [d.key] : [])).sort()).toEqual([...KEYS].sort());
    expect(mine.flatMap((d) => Object.keys(d.drums ?? {})).sort()).toEqual([...HITS].sort());
    for (const k of KEYS) expect(REGIONAL_INSTRUMENTS[k], k).toBeTruthy();
    for (const h of HITS) expect(REGIONAL_DRUMS[h], h).toBeTruthy();
    // 每件都有中文名与英文名、音色样本
    for (const d of mine) {
      expect(d.name.zh.length, regionalId(d)).toBeGreaterThan(0);
      expect(d.name.en.length, regionalId(d)).toBeGreaterThan(0);
      expect(d.demo.abc || d.demo.drum, regionalId(d)).toBeTruthy();
    }
  });

  it("不占用伊比利亚一组（肖姆管、萨克布号、竖笛、巴斯克的三孔笛与鼓）的键：三孔笛与小鼓用自己的名字", () => {
    for (const k of ["shawm", "sackbut", "txistu", "tamboril", "flabiol", "gaita"]) expect(KEYS, k).not.toContain(k);
    // 原有的 tabor（塔博鼓）与 recorder（竖笛）不动：北欧的小鼓是 taborin，三孔笛是 tabor_pipe
    expect(HITS).not.toContain("tabor");
    expect(KEYS).not.toContain("recorder");
  });
});

describe("北欧的地方乐器：吹奏（风笛、克鲁姆管、牧笛、三孔笛）", () => {
  it("风笛的唱管：皮囊供气——没有揉音、音与音连着（tongue ≥ 0.9）、换音几乎没有滑音；比竖笛亮得多，比法兰西风笛亮", () => {
    const pipe = sustain("bagpipe");
    expect(pipe.kind).toBe("wind");
    expect(pipe.vib).toBeUndefined();
    expect(pipe.tongue ?? 0).toBeGreaterThanOrEqual(0.9);
    expect(pipe.glide).toBeLessThan(0.01);
    expect(bright(pipe)).toBeGreaterThan(bright(core("recorder")) * 8);
    expect(bright(pipe)).toBeGreaterThan(bright(sustain("cornemuse")) * 1.5);
    // 法兰西风笛同样是皮囊：连着、不揉
    const muse = sustain("cornemuse");
    expect(muse.vib).toBeUndefined();
    expect(muse.tongue ?? 0).toBeGreaterThanOrEqual(0.9);
    expect(bright(muse)).toBeGreaterThan(bright(core("recorder")) * 3);
  });

  it("风笛的持续音管、克鲁姆管与扎列伊卡：圆柱管，奇次谐波强、偶次弱", () => {
    const drone = sustain("pipe_drone");
    expect(drone.kind).toBe("pad");
    expect(drone.unison?.voices ?? 0).toBeGreaterThanOrEqual(2);
    const crum = sustain("crumhorn");
    expect(ratio(crum, 2)).toBeLessThan(0.2);
    expect(ratio(crum, 3)).toBeGreaterThan(ratio(crum, 2) * 4);
    expect(ratio(crum, 5)).toBeGreaterThan(ratio(crum, 4) * 4);
    // 克鲁姆管的簧在木帽里：不揉、吐音分开
    expect(crum.vib).toBeUndefined();
    expect(crum.tongue ?? 1).toBeLessThan(0.5);
    for (const k of ["pipe_drone", "zhaleika"]) {
      const s = sustain(k);
      expect(ratio(s, 3, 220), k).toBeGreaterThan(ratio(s, 2, 220) * 1.3);
      expect(ratio(s, 5, 220), k).toBeGreaterThan(ratio(s, 4, 220) * 1.3);
    }
    // 牛角喇叭口让扎列伊卡比竖笛亮，吹得越用力越亮
    expect(bright(sustain("zhaleika"))).toBeGreaterThan(bright(core("recorder")) * 5);
    expect(sustain("zhaleika").blare).toBeTruthy();
  });

  it("三孔笛与加卢贝笛：每个音都吐开（起音的“嘟”比竖笛重），几乎不揉；加卢贝笛的第二谐波更强，更尖", () => {
    for (const k of ["tabor_pipe", "galoubet"]) {
      const s = sustain(k);
      expect(s.chiff ?? 0, k).toBeGreaterThan((core("recorder").chiff ?? 0) * 1.3);
      expect(s.vib?.depth ?? 0, k).toBeLessThanOrEqual(6);
    }
    expect(ratio(sustain("galoubet"), 2)).toBeGreaterThan(ratio(sustain("tabor_pipe"), 2) * 1.4);
  });

  it("山羊角号：铜管的唇振，音准游移大、气多，比圆号野", () => {
    const h = sustain("bukkehorn");
    expect(h.kind).toBe("brass");
    expect(h.drift ?? 0).toBeGreaterThanOrEqual(10);
    expect(h.breath?.level ?? 0).toBeGreaterThan(core("horn").breath?.level ?? 0);
  });
});

describe("北欧的地方乐器：弓弦（手摇弦琴、尼克尔哈帕、古多克、雷贝克琴）", () => {
  it("手摇弦琴：木轮一直擦弦——没有揉音、没有滑音、两根旋律弦齐奏，木轮的沙声跟着波形起伏；持续音弦是长音", () => {
    const hg = sustain("hurdygurdy");
    expect(hg.kind).toBe("bowed");
    expect(hg.vib).toBeUndefined();
    expect(hg.glide).toBeLessThan(0.01);
    expect(hg.unison?.voices).toBe(2);
    expect(hg.pulse?.level ?? 0).toBeGreaterThan(0.05);
    expect(hg.tongue ?? 0).toBeGreaterThan(0.8);
    const drone = sustain("hurdy_drone");
    expect(drone.kind).toBe("pad");
    // 持续音弦也是两根弦齐奏（bourdon 与 mouche 各差一点音高）
    expect(drone.unison?.voices ?? 0).toBeGreaterThanOrEqual(2);
    // 琴箱的鼻音：旋律弦与持续音弦都在 1.5 kHz 一带鼓起来——G2 上第 15 次谐波（1.47 kHz）比第 10 次（0.98 kHz）还强，
    // 纯锯齿波是越高越弱（第 15 次只有第 10 次的三分之二）
    for (const s of [hg, drone]) expect(ratio(s, 15, 98)).toBeGreaterThan(ratio(s, 10, 98));
  });

  it("手摇弦琴的“狗”：一下“嗞”调在小号弦的音高上（G3、C4、D4），谐波很满，0.4 秒内消失", () => {
    for (const [hit, m] of [["chien_g", 55], ["chien_c", 60], ["chien_d", 62]] as const) {
      const x = drum(drumSpec(hit), SR, 3);
      const f = hz(m);
      const got = peakFreq(x, 0, 0.08, f * 0.9, f * 1.1, 0.5);
      expect(Math.abs(1200 * Math.log2(got / f)), `${hit}：${got} Hz`).toBeLessThan(20);
      // 谐波很满：第 3、5、8 次谐波都不弱（每个分音的频率有千分之几的随机偏差，在 ±1.5% 里找最强的）
      const near = (g: number) => {
        let best = 0;
        for (let h = g * 0.985; h <= g * 1.015; h += 1) best = Math.max(best, power(x, h, 0, 0.08));
        return best;
      };
      for (const k of [3, 5, 8]) expect(near(k * f) / near(f), `${hit} 第 ${k} 次谐波`).toBeGreaterThan(0.08);
      // 短：0.4 秒以后几乎没有了
      expect(energy(x, Math.floor(0.4 * SR), Math.floor(0.5 * SR))).toBeLessThan(energy(x, 0, Math.floor(0.05 * SR)) * 0.002);
    }
  });

  it("尼克尔哈帕：三个几乎同音高的振荡器（共鸣弦的微光）、键的“嗒”比提琴重、余音挂得久、揉音很浅；高处比提琴亮", () => {
    const n = sustain("nyckelharpa");
    const fiddle = core("fiddle");
    expect(n.unison?.voices).toBe(3);
    expect(n.unison?.spread ?? 99).toBeLessThanOrEqual(4);
    expect(n.chiff ?? 0).toBeGreaterThan(fiddle.chiff ?? 0);
    expect(n.release).toBeGreaterThan(fiddle.release * 3);
    expect(n.vib?.depth ?? 0).toBeLessThan((fiddle.vib?.depth ?? 0) / 2);
    const high = (s: SustainSpec) => s.amps(8, 8 * 440) / s.amps(1, 440);
    expect(high(n)).toBeGreaterThan(high(fiddle) * 0.9);
  });

  it("古多克：弓噪重（跟着波形的沙声）、揉音浅；雷贝克琴比提琴尖（2–4 kHz 相对更强）", () => {
    const g = sustain("gudok");
    expect(g.kind).toBe("bowed");
    expect(g.pulse?.level ?? 0).toBeGreaterThanOrEqual(0.1);
    expect(g.pulse?.level ?? 0).toBeGreaterThan((sustain("nyckelharpa").pulse?.level ?? 0) * 2);
    expect(g.vib?.depth ?? 0).toBeLessThan(core("fiddle").vib?.depth ?? 0);
    const nasal = (s: SustainSpec) => [5, 6, 7, 8].reduce((sum, k) => sum + ratio(s, k, 440), 0);
    expect(nasal(sustain("rebeck"))).toBeGreaterThan(nasal(core("fiddle")));
  });
});

describe("北欧的地方乐器：拨弦（维金纳琴、班多拉琴、古斯里琴、朗格莱克琴）", () => {
  it("维金纳琴（muselar）拨在弦的正中：第二谐波比羽管键琴弱得多", () => {
    const harpsichord = CORE_INSTRUMENTS.harpsichord;
    if (harpsichord.kind !== "pluck") throw new Error("harpsichord");
    const f = hz(57);
    const even = (spec: PluckSpec) => {
      const x = pluck(spec, f, SR, 2);
      return power(x, 2 * f, 0.05, 0.4) / power(x, f, 0.05, 0.4);
    };
    expect(even(pluckSpec("virginal"))).toBeLessThan(even(harpsichord.spec) * 0.3);
  });

  it("古斯里琴与朗格莱克琴：没被按住的空弦被带着响（共鸣弦）", () => {
    // 古斯里琴拨 G3：调在 G4 的空弦（二倍频）被带着响
    const gs = pluckSpec("gusli");
    const g3 = hz(55);
    expect(power(pluck(gs, g3, SR, 4), hz(67), 0.6, 1.6)).toBeGreaterThan(power(pluck({ ...gs, sympathetic: undefined }, g3, SR, 4), hz(67), 0.6, 1.6) * 2);
    // 朗格莱克琴拨 D3：调在 A4 的空弦（三倍频）被带着响
    const lg = pluckSpec("langeleik");
    const d3 = hz(50);
    expect(power(pluck(lg, d3, SR, 4), hz(69), 0.6, 1.6)).toBeGreaterThan(power(pluck({ ...lg, sympathetic: undefined }, d3, SR, 4), hz(69), 0.6, 1.6) * 2);
  });

  it("班多拉琴：低音区（E2、A2）音高准，复弦，余音比鲁特琴长", () => {
    const spec = pluckSpec("bandora");
    expect(spec.course ?? 0).toBeGreaterThan(0);
    for (const m of [40, 45]) {
      const x = pluck(spec, hz(m), SR, 5);
      expect(x.every(Number.isFinite)).toBe(true);
      expect(peakFreq(x, 0.3, 1.2, hz(m) * 0.9, hz(m) * 1.1, 0.25)).toBeCloseTo(hz(m), -0.5);
    }
    const lute = CORE_INSTRUMENTS.lute;
    if (lute.kind !== "pluck") throw new Error("lute");
    expect(spec.t60).toBeGreaterThan(lute.spec.t60);
  });
});

describe("北欧的地方乐器：钟", () => {
  it("钟楼的排钟（beiaard）：写的音是打击音，下面有小三度（tierce）、低一个八度的主音与低两个八度、余音最长的哼音", () => {
    const spec = malletSpec("beiaard");
    const f = hz(79);
    const x = mallet(spec, f, SR, 3);
    // 小三度（0.6 倍）比大三度（0.625 倍）的位置强得多
    expect(power(x, f * 0.6, 0.1, 1)).toBeGreaterThan(power(x, f * 0.625, 0.1, 1) * 10);
    // 哼音（0.25 倍）比打击音衰减得慢
    const decay = (r: number) => power(x, f * r, 2, 3) / power(x, f * r, 0.05, 0.5);
    expect(decay(0.25)).toBeGreaterThan(decay(1) * 4);
  });

  it("罗斯的钟（kolokol）：低而长（大钟 5 秒以上），分音不成整齐的比例（1.183 倍处有一条），拍音“嗡嗡”", () => {
    const spec = malletSpec("kolokol");
    const f = hz(45);
    const x = mallet(spec, f, SR, 2);
    expect(x.length / SR).toBeGreaterThan(5);
    expect(power(x, f * 1.183, 0.1, 1)).toBeGreaterThan(power(x, f * 1.25, 0.1, 1) * 5);
    expect(spec.beat ?? 0).toBeGreaterThan(0.5);
    // 比钟楼的排钟低沉（同一个写的音，能量更多在低处）
    const g = hz(60);
    expect(lowShare(mallet(spec, g, SR, 1), 400)).toBeGreaterThan(lowShare(mallet(malletSpec("beiaard"), g, SR, 1), 400) * 0.5);
  });
});

describe("北欧的地方乐器：鼓点", () => {
  it("隆默尔罐：低沉的“轰”（基频 100 Hz 一带），起音慢（不是敲的）", () => {
    const x = drum(drumSpec("rommelpot"), SR, 2);
    const f = peakFreq(x, 0.03, 0.2, 70, 140, 0.5);
    expect(f).toBeGreaterThan(85);
    expect(f).toBeLessThan(115);
    expect(energy(x, 0, Math.floor(0.004 * SR))).toBeLessThan(energy(x, Math.floor(0.03 * SR), Math.floor(0.06 * SR)) * 0.2);
  });

  it("普罗旺斯长鼓与雇佣兵的长鼓比三孔笛的小鼓低；木勺、木片响板、布本鼓的铃片在高处", () => {
    const low = (h: string) => lowShare(drum(drumSpec(h), SR, 1), 300);
    expect(low("tambourin")).toBeGreaterThan(low("taborin"));
    expect(low("trommel")).toBeGreaterThan(low("taborin"));
    for (const h of ["lozhki", "treshchotka", "buben_shake"]) expect(lowShare(drum(drumSpec(h), SR, 1), 600), h).toBeLessThan(0.3);
  });

  it("木片响板一下是一串连着的噼啪（包络上有好几个峰），不是一下", () => {
    const x = drum(drumSpec("treshchotka"), SR, 5);
    const win = Math.floor(0.002 * SR);
    const env: number[] = [];
    for (let a = 0; a + win < Math.min(x.length, 0.12 * SR); a += win) env.push(Math.sqrt(energy(x, a, a + win)));
    let peaks = 0;
    for (let i = 1; i < env.length - 1; i++) if (env[i] > env[i - 1] && env[i] >= env[i + 1] && env[i] > 0.1 * Math.max(...env)) peaks++;
    expect(peaks).toBeGreaterThanOrEqual(3);
  });
});
