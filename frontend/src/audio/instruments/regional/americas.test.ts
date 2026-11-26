// 地方乐器第二阶段·美洲（阿兹特克、泰诺、图皮，另给安第斯与玛雅添几件）：登记，以及每件合成出来的声音的“签名”——
// 橡胶槌的特波纳兹特利比木槌的屯库尔软、敲下去音高往下一沉，硬棍的马约瓦坎起音亮；韦韦特尔低、余音长；
// 果壳串是一阵密密的“咔啦啦”、刮瓜是有节律的一串、响杖先“咚”后“沙”；马拉卡一高一低、图皮的圣沙铃更低更厚、抖起来是长长的一阵；
// 跺地竹筒是一端封闭的管（奇次谐波）；万卡拉与廷亚的鼓面弦“嗞”地嗡；骨刮的槽宽、一下下分得清、带着共鸣腔的“空”；
// 马普切的库尔特伦鼓比邦博鼓高、碗里的石子跟着“沙啦”；吹奏的谐波表与气声（双气室的陶笛、粗糙的风哨、亮的骨笛、
// 气多的竹笛、带“嘟噜”的普图图与特鲁特鲁卡、鼻音的奇里米亚）。确定、没有非数、峰值归一由 regional.test.ts 对全部地方乐器逐件检查。
import { describe, expect, it } from "vitest";
import { biquad, drum, filter, mallet, peak, type DrumSpec, type MalletSpec } from "../../dsp";
import type { SustainSpec } from "../../instruments";
import { realizePass } from "../../score";
import { demoTrack, REGIONAL, REGIONAL_DRUMS, REGIONAL_INSTRUMENTS, regionalId } from ".";

const SR = 44100;
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function malletSpec(key: string): MalletSpec {
  const i = REGIONAL_INSTRUMENTS[key];
  if (!i || i.kind !== "mallet") throw new Error(key);
  return i.spec;
}
function sustain(key: string): SustainSpec {
  const i = REGIONAL_INSTRUMENTS[key];
  if (!i || i.kind === "pluck" || i.kind === "mallet" || i.kind === "perc") throw new Error(key);
  return i;
}
function hit(name: string): DrumSpec {
  const d = REGIONAL_DRUMS[name];
  if (!d) throw new Error(name);
  return d;
}

/** [t0, t1) 秒里 f 以下的能量占比（一阶低通分频）。 */
function lowShare(x: Float32Array, f: number, t0 = 0, t1 = x.length / SR): number {
  const a = 1 - Math.exp((-2 * Math.PI * f) / SR);
  let lp = 0,
    eLow = 0,
    eAll = 0;
  const b = Math.min(x.length, Math.floor(t1 * SR));
  for (let n = 0; n < b; n++) {
    lp += a * (x[n] - lp);
    if (n < t0 * SR) continue;
    eLow += lp * lp;
    eAll += x[n] * x[n];
  }
  return eLow / Math.max(1e-12, eAll);
}

function energy(x: Float32Array, t0: number, t1: number): number {
  let e = 0;
  const a = Math.floor(t0 * SR);
  const b = Math.min(x.length, Math.floor(t1 * SR));
  for (let n = a; n < b; n++) e += x[n] * x[n];
  return e / Math.max(1, b - a);
}

/** [t0, t1) 秒里 fc 以上（两级二阶高通）的能量占全部的比例。 */
function highShare(x: Float32Array, fc: number, t0: number, t1: number): number {
  const y = Float32Array.from(x);
  const c = biquad("highpass", fc, 0.707, 0, SR);
  filter(y, c);
  filter(y, c);
  return energy(y, t0, t1) / Math.max(1e-12, energy(x, t0, t1));
}

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

/** [t0, t1) 秒里功率最大的频率（lo–hi Hz，按 step 扫）。 */
function peakFreq(x: Float32Array, t0: number, t1: number, lo: number, hi: number, step = 0.5): number {
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

/** 1 毫秒一格的均方根包络。 */
function envelope(x: Float32Array): number[] {
  const win = Math.floor(SR * 0.001);
  const out: number[] = [];
  for (let a = 0; a + win <= x.length; a += win) out.push(Math.sqrt(energy(x, a / SR, (a + win) / SR)));
  return out;
}

/** 包络里的“咔”：比前后各 2 毫秒都高、比前后各 4 毫秒的平均高出四成、且超过最大值 15% 的局部峰的个数（一团平平的噪声几乎没有）。 */
function grains(x: Float32Array): number {
  const e = envelope(x);
  const top = Math.max(...e);
  let n = 0;
  for (let i = 4; i < e.length - 4; i++) {
    const around = e.slice(i - 4, i + 5).reduce((s, v) => s + v, 0) / 9;
    if (e[i] > top * 0.15 && e[i] > around * 1.4 && e[i] >= e[i - 1] && e[i] >= e[i - 2] && e[i] > e[i + 1] && e[i] > e[i + 2]) n++;
  }
  return n;
}

/** 包络（去掉平均）的自相关在 lo–hi 毫秒里最大处的间隔（毫秒）。 */
function period(x: Float32Array, lo: number, hi: number, from = 0.02, to = 0.19): number {
  const e = envelope(x).slice(Math.floor(from * 1000), Math.floor(to * 1000));
  const mean = e.reduce((s, v) => s + v, 0) / e.length;
  const d = e.map((v) => v - mean);
  let best = -Infinity;
  let at = lo;
  for (let lag = lo; lag <= hi; lag++) {
    let s = 0;
    for (let i = 0; i + lag < d.length; i++) s += d[i] * d[i + lag];
    if (s > best) {
      best = s;
      at = lag;
    }
  }
  return at;
}

describe("第二阶段·美洲：登记", () => {
  it("阿兹特克（墨西加）、泰诺、图皮各至少三件；安第斯添了万卡拉、廷亚、普图图与马普切的库尔特伦、特鲁特鲁卡，玛雅添了奇里米亚", () => {
    const of = (r: string) => REGIONAL.filter((d) => d.region === r).map(regionalId);
    expect(of("mexica")).toEqual(["teponaztli", "huehuetl", "ayoyotl", "chicahuaztli", "omichicahuaztli", "tlapitzalli", "ehecachichtli"]);
    expect(of("taino")).toEqual(["mayohuacan", "maraca_hi", "guiro_long", "bone_flute"]);
    expect(of("tupi")).toEqual(["mbaraka", "taboca", "takuapu"]);
    for (const id of ["wankara", "tinya", "pututu", "kultrun", "trutruka"]) expect(of("andes")).toContain(id);
    expect(of("maya")).toContain("chirimia");
    for (const k of ["teponaztli", "tlapitzalli", "ehecachichtli", "mayohuacan", "bone_flute", "taboca", "pututu", "chirimia", "trutruka"]) expect(REGIONAL_INSTRUMENTS[k], k).toBeTruthy();
    for (const h of ["huehuetl", "huehuetl_ti", "ayoyotl", "ayoyotl_soft", "chicahuaztli", "chicahuaztli_shake", "omichicahuaztli", "omichicahuaztli_short", "mayo_rim", "maraca_hi", "maraca_lo", "guiro_long", "guiro_short", "mbaraka", "mbaraka_roll", "takuapu", "takuapu_hi", "wankara", "wankara_rim", "tinya", "tinya_soft", "kultrun", "kultrun_soft"])
      expect(REGIONAL_DRUMS[h], h).toBeTruthy();
  });
});

describe("第二阶段·美洲：裂缝木鼓", () => {
  const f = hz(50);

  it("特波纳兹特利（橡胶槌）比屯库尔（木槌）起音软：头 12 毫秒里 1.5 kHz 以上的能量少得多；敲下去音高往下一沉", () => {
    const tepo = mallet(malletSpec("teponaztli"), f, SR, 3);
    const tunkul = mallet(malletSpec("tunkul"), f, SR, 3);
    const hiTepo = highShare(tepo, 1500, 0, 0.012);
    const hiTunkul = highShare(tunkul, 1500, 0, 0.012);
    expect(hiTepo, `${hiTepo.toFixed(3)} 对 ${hiTunkul.toFixed(3)}`).toBeLessThan(hiTunkul * 0.5);
    const early = peakFreq(tepo, 0, 0.015, f * 0.95, f * 1.06);
    const late = peakFreq(tepo, 0.1, 0.3, f * 0.95, f * 1.06);
    expect(early / late, `${early} → ${late} Hz`).toBeGreaterThan(1.006);
    expect(Math.abs(1200 * Math.log2(late / f))).toBeLessThan(15);
  });

  it("马约瓦坎（硬木棍）起音比特波纳兹特利亮得多，余音短", () => {
    const mayo = mallet(malletSpec("mayohuacan"), f, SR, 3);
    const tepo = mallet(malletSpec("teponaztli"), f, SR, 3);
    expect(highShare(mayo, 1500, 0, 0.012)).toBeGreaterThan(highShare(tepo, 1500, 0, 0.012) * 3);
    expect(mayo.length).toBeLessThan(tepo.length);
  });
});

describe("第二阶段·美洲：鼓与响器", () => {
  it("韦韦特尔低沉、余音长（比玛雅的帕克斯鼓拖得久），鼓边的“嗒”在高处", () => {
    const h = drum(hit("huehuetl"), SR, 1);
    const pax = drum(REGIONAL_DRUMS.pax, SR, 1);
    expect(lowShare(h, 250)).toBeGreaterThan(0.7);
    expect(energy(h, 0.4, 0.7) / energy(h, 0, 0.1)).toBeGreaterThan((energy(pax, 0.4, 0.7) / energy(pax, 0, 0.1)) * 2);
    expect(lowShare(drum(hit("huehuetl_ti"), SR, 1), 250)).toBeLessThan(0.3);
  });

  it("果壳串是一阵密密的“咔啦啦”（十几下），葫芦沙铃只是一团“沙”", () => {
    const shells = grains(drum(hit("ayoyotl"), SR, 2));
    const sonaja = grains(drum(REGIONAL_DRUMS.sonaja, SR, 2));
    expect(shells, `${shells} 对 ${sonaja}`).toBeGreaterThanOrEqual(6);
    expect(sonaja, `${shells} 对 ${sonaja}`).toBeLessThanOrEqual(2);
  });

  it("刮瓜：一长刮约 0.2 秒，里面的“咔”按槽的间隔（每秒 72 下，约 14 毫秒）有节律地排着；短刮短得多", () => {
    const x = drum(hit("guiro_long"), SR, 5);
    expect(x.length / SR).toBeGreaterThan(0.19);
    const p = period(x, 8, 25);
    expect(Math.abs(p - 1000 / 72), `${p} 毫秒`).toBeLessThanOrEqual(2);
    expect(grains(x)).toBeGreaterThanOrEqual(8);
    expect(drum(hit("guiro_short"), SR, 5).length).toBeLessThan(x.length * 0.5);
  });

  it("骨刮：槽比刮瓜宽（“咔”的间隔约 31 毫秒，刮瓜约 14 毫秒），一长刮顺着整根骨头（0.4 秒以上），每一下都带着共鸣腔 820 Hz 上下的“空”", () => {
    const x = drum(hit("omichicahuaztli"), SR, 5);
    expect(x.length / SR).toBeGreaterThan(0.4);
    const p = period(x, 18, 45, 0.03, 0.4);
    // 槽是手刻的（间隔各自抖 ±12%），自相关的峰落在 31 毫秒上下几毫秒
    expect(Math.abs(p - 1000 / 32), `${p} 毫秒`).toBeLessThanOrEqual(5);
    expect(p).toBeGreaterThan(period(drum(hit("guiro_long"), SR, 5), 8, 25) * 1.8);
    expect(grains(x)).toBeGreaterThanOrEqual(10);
    // 共鸣腔：820 Hz 上下的功率比两边（520、1300 Hz）高得多；刮瓜没有这一声
    const avg = (y: Float32Array, f: number) => {
      let sum = 0;
      for (let t = 0; t + 0.05 <= Math.min(0.4, y.length / SR); t += 0.025) sum += power(y, f, t, t + 0.05);
      return sum;
    };
    const hollow = (y: Float32Array) => avg(y, 820) / Math.max(avg(y, 520), avg(y, 1300));
    expect(peakFreq(x, 0, 0.4, 600, 1100, 5), "共鸣腔").toBeGreaterThan(760);
    expect(peakFreq(x, 0, 0.4, 600, 1100, 5), "共鸣腔").toBeLessThan(880);
    expect(hollow(x)).toBeGreaterThan(hollow(drum(hit("guiro_long"), SR, 5)) * 3);
    expect(drum(hit("omichicahuaztli_short"), SR, 5).length).toBeLessThan(x.length * 0.5);
  });

  it("刮奏层从 0 起：头 0.5 毫秒几乎没有声音（在安静处不“咔”地蹦出来）", () => {
    for (const h of ["guiro_long", "ayoyotl_soft", "chicahuaztli_shake", "mbaraka_roll", "omichicahuaztli", "omichicahuaztli_short"]) {
      const x = drum(hit(h), SR, 4);
      const head = Math.max(...Array.from(x.subarray(0, Math.floor(SR * 0.0005))).map(Math.abs));
      expect(head, h).toBeLessThan(peak(x) * 0.15);
    }
  });

  it("响杖先是杖落地的一声闷响（低频），跟着杖头里一阵“沙”（60 毫秒以后 2 kHz 以上的能量）", () => {
    const x = drum(hit("chicahuaztli"), SR, 3);
    expect(lowShare(x, 300, 0, 0.03)).toBeGreaterThan(0.3);
    expect(1 - lowShare(x, 2000, 0.06, 0.18)).toBeGreaterThan(0.6);
  });

  it("马拉卡一高一低、都很短；图皮的圣沙铃比马拉卡低、厚，长长地抖是半秒以上的一阵", () => {
    const hi = drum(hit("maraca_hi"), SR, 2);
    const lo = drum(hit("maraca_lo"), SR, 2);
    expect(lowShare(lo, 4000)).toBeGreaterThan(lowShare(hi, 4000));
    expect(hi.length / SR).toBeLessThan(0.15);
    expect(lo.length / SR).toBeLessThan(0.15);
    const mb = drum(hit("mbaraka"), SR, 2);
    expect(lowShare(mb, 3000)).toBeGreaterThan(lowShare(hi, 3000) * 1.5);
    expect(drum(hit("mbaraka_roll"), SR, 2).length / SR).toBeGreaterThan(0.5);
  });

  it("跺地竹筒是一端封闭的管：三倍频比二倍频响得多；短的一根更高", () => {
    const x = drum(hit("takuapu"), SR, 1);
    const f = peakFreq(x, 0.02, 0.2, 140, 200);
    expect(power(x, 3 * f, 0.01, 0.12)).toBeGreaterThan(power(x, 2 * f, 0.01, 0.12) * 5);
    expect(peakFreq(drum(hit("takuapu_hi"), SR, 1), 0.02, 0.2, 140, 280)).toBeGreaterThan(f * 1.2);
  });

  it("万卡拉的鼓面弦：比邦博鼓多一层长的“嗞”（80–300 毫秒里 1.4 kHz 以上的能量）；廷亚更高、也带“嗞”", () => {
    const buzz = (x: Float32Array) => energy(x, 0.08, 0.3) * highShare(x, 1400, 0.08, 0.3);
    const w = drum(hit("wankara"), SR, 1);
    const b = drum(REGIONAL_DRUMS.bombo, SR, 1);
    expect(buzz(w)).toBeGreaterThan(buzz(b) * 4);
    expect(lowShare(w, 250)).toBeGreaterThan(0.5);
    const t = drum(hit("tinya"), SR, 1);
    expect(lowShare(t, 250)).toBeLessThan(0.3);
    expect(highShare(t, 1800, 0.05, 0.15)).toBeGreaterThan(0.3);
  });

  it("库尔特伦（马普切）：浅碗的鼓，比邦博鼓高（鼓皮落在 150 Hz 上下）、余音短；碗里的石子跟着“沙啦”一阵（80–250 毫秒里 1.4 kHz 以上的能量）", () => {
    const k = drum(hit("kultrun"), SR, 1);
    const b = drum(REGIONAL_DRUMS.bombo, SR, 1);
    const fk = peakFreq(k, 0.03, 0.25, 100, 260);
    expect(fk).toBeGreaterThan(135);
    expect(fk).toBeLessThan(170);
    expect(fk).toBeGreaterThan(peakFreq(b, 0.03, 0.25, 40, 260) * 1.8);
    expect(k.length).toBeLessThan(b.length);
    const pebbles = (x: Float32Array) => energy(x, 0.08, 0.25) * highShare(x, 1400, 0.08, 0.25);
    expect(pebbles(k)).toBeGreaterThan(pebbles(b) * 3);
  });
});

describe("第二阶段·美洲：吹奏", () => {
  const ratio = (k: string, n: number, f0 = 440) => sustain(k).amps(n, n * f0) / sustain(k).amps(1, f0);
  const air = (k: string) => (sustain(k).breath?.level ?? 0) + (sustain(k).pulse?.level ?? 0);

  it("阿兹特克陶笛：两个气室（两个略有音差的振荡器齐奏），第三谐波比第二谐波强", () => {
    const s = sustain("tlapitzalli");
    expect(s.unison?.voices).toBe(2);
    expect(s.unison!.spread).toBeGreaterThan(5);
    expect(s.unison!.spread).toBeLessThan(25);
    expect(ratio("tlapitzalli", 3)).toBeGreaterThan(ratio("tlapitzalli", 2) * 1.5);
  });

  it("风哨：气声比美洲的吹奏乐器与第一阶段气声重的笛子都多、两个气室差得远（粗的拍）、气流抖得快；音头慢、滑音长", () => {
    const s = sustain("ehecachichtli");
    // 只与美洲各地区的吹奏乐器和第一阶段气声重的几支笛子比（别的地区以后并行添的乐器不在这里比，免得互相牵扯）
    const americas = REGIONAL.filter((d) => ["mexica", "taino", "tupi", "andes", "maya"].includes(d.region) && d.key && REGIONAL_INSTRUMENTS[d.key].kind === "wind").map((d) => d.key as string);
    const breathy = ["shakuhachi", "nay", "xiao", "bansuri", "suling", "shinobue", "ryuteki"];
    expect(americas.length).toBeGreaterThanOrEqual(8);
    for (const k of [...americas, ...breathy]) if (k !== "ehecachichtli") expect(air("ehecachichtli"), k).toBeGreaterThan(air(k));
    expect(s.unison!.spread).toBeGreaterThanOrEqual(30);
    expect(s.tremor!.rate).toBeGreaterThanOrEqual(8);
    expect(s.attack).toBeGreaterThan(0.1);
    expect(s.glide).toBeGreaterThan(0.1);
  });

  it("泰诺骨笛比玛雅陶笛、图皮竹笛亮；图皮竹笛的气比盖那笛多、揉得比盖那笛浅", () => {
    const bright = (k: string) => [2, 3, 4].reduce((s, n) => s + ratio(k, n), 0);
    expect(bright("bone_flute")).toBeGreaterThan(bright("ocarina") * 3);
    expect(bright("bone_flute")).toBeGreaterThan(bright("taboca") * 1.3);
    const puff = (k: string) => air(k) + (sustain(k).puff?.level ?? 0);
    expect(puff("taboca")).toBeGreaterThan(puff("quena"));
    expect(sustain("taboca").vib!.depth).toBeLessThan(sustain("quena").vib!.depth * 0.5);
  });

  it("普图图比玛雅的海螺号亮，带嘴唇的“嘟噜”（每秒十几二十下的起伏）", () => {
    const bright = (k: string) => [6, 8, 10].reduce((s, n) => s + ratio(k, n, 220), 0);
    expect(bright("pututu")).toBeGreaterThan(bright("conch") * 1.3);
    expect(sustain("pututu").tremor!.rate).toBeGreaterThanOrEqual(15);
    expect(sustain("pututu").kind).toBe("brass");
  });

  it("特鲁特鲁卡（马普切的长号）：牛角口比海螺号亮、高次谐波下降得最慢；嘴唇的颤；音样本只吹管子的自然泛音（G 管的 D、G、B）", () => {
    const bright = (k: string) => [6, 8, 10].reduce((s, n) => s + ratio(k, n, 110), 0);
    expect(bright("trutruka")).toBeGreaterThan(bright("conch") * 1.5);
    expect(ratio("trutruka", 12, 110)).toBeGreaterThan(ratio("pututu", 12, 110));
    expect(sustain("trutruka").kind).toBe("brass");
    expect(sustain("trutruka").tremor!.rate).toBeGreaterThanOrEqual(15);
    const def = REGIONAL.find((d) => d.key === "trutruka")!;
    const notes = new Set(realizePass(demoTrack(def), 0).events.map((e) => ((e.m % 12) + 12) % 12));
    for (const pc of notes) expect([2, 7, 11], `音级 ${pc}`).toContain(pc);
  });

  it("奇里米亚是双簧管一族：比陶笛、竹笛亮得多，但比祖尔纳暗", () => {
    const bright = (k: string) => [6, 8, 10].reduce((s, n) => s + ratio(k, n), 0);
    for (const flute of ["ocarina", "taboca", "tlapitzalli", "bone_flute"]) expect(bright("chirimia"), flute).toBeGreaterThan(bright(flute) * 3);
    expect(bright("chirimia")).toBeLessThan(bright("zurna"));
  });
});
