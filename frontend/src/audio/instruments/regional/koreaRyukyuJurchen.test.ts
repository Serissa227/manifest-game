// 地方乐器第二阶段：朝鲜、琉球、女真与满洲。登记、确定性与峰值由 regional.test.ts 对全部乐器统一检查；
// 这里查每件乐器“一听就知道是它”的那一点：伽倻琴与玄琴的弄弦又深又慢、玄琴竹片打在皮垫上、伽倻琴用指肉弹（起音比日本的筝软）、
// 三线没有三味线的“嗞”而有蛇皮的一下、奚琴的弓噪与滑音比二胡重、大笒的膜与气、觱篥的圆柱管（奇次谐波）、太平箫的亮；
// 杖鼓左低右高、两面一起是“덩”，鼓与大太鼓在低处，小金又亮又尖（按住时一下就止），钲低而长、拍音一涨一落、音高不沉不翘；
// 三板是几片木头先后碰上的连串“咔”，神鼓的铁环在鼓声后面“哗啦”，腰铃先涌起来再散开；号角暗而粗；
// 口弦的簧片总在 G2 上嗡、旋律是被嘴挑出来的泛音（F5 落在偏低的第七泛音上）。
import { describe, expect, it } from "vitest";
import { drum, mallet, peak, pluck, type MalletSpec, type PluckSpec } from "../../dsp";
import { PLUCK_VIB } from "../../engine";
import { CORE_INSTRUMENTS, type Instrument, type SustainSpec } from "../../instruments";
import { REGIONAL, REGIONAL_DRUMS, REGIONAL_INSTRUMENTS, regionalId } from ".";

const SR = 44100;
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function inst(key: string): Instrument {
  const i = REGIONAL_INSTRUMENTS[key];
  if (!i) throw new Error(key);
  return i;
}
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
function sustain(key: string): SustainSpec {
  const i = inst(key);
  if (i.kind === "pluck" || i.kind === "mallet" || i.kind === "perc") throw new Error(key);
  return i;
}

function energy(x: Float32Array, a: number, b: number): number {
  let e = 0;
  for (let n = a; n < Math.min(b, x.length); n++) e += x[n] * x[n];
  return e / Math.max(1, b - a);
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

/** 一阶低通把信号分成 f 以下与以上：f 以下的能量比例（[a, b) 个采样，缺省整段）。 */
function lowShare(x: Float32Array, f: number, a = 0, b = x.length): number {
  const k = 1 - Math.exp((-2 * Math.PI * f) / SR);
  let lp = 0,
    eLow = 0,
    eAll = 0;
  for (let n = 0; n < Math.min(b, x.length); n++) {
    lp += k * (x[n] - lp);
    if (n < a) continue;
    eLow += lp * lp;
    eAll += x[n] * x[n];
  }
  return eLow / eAll;
}

/** 5 毫秒一格的均方根包络。 */
function envelope(x: Float32Array, ms = 5): number[] {
  const win = Math.floor((ms / 1000) * SR);
  const out: number[] = [];
  for (let a = 0; a + win <= x.length; a += win) out.push(Math.sqrt(energy(x, a, a + win)));
  return out;
}

describe("第二阶段的登记：朝鲜、琉球、女真与满洲", () => {
  it("每个地区的乐器都在，键与鼓点名对得上", () => {
    const by = (r: string) => REGIONAL.filter((d) => d.region === r).map(regionalId);
    expect(by("korea")).toEqual(["gayageum", "geomungo", "haegeum", "daegeum", "piri", "taepyeongso", "janggu_kung", "buk", "kkwaeng", "jing"]);
    expect(by("ryukyu")).toEqual(["sanshin", "kucho", "sanba", "eisa_don", "paranku", "yubibue"]);
    expect(by("jurchen")).toEqual(["yemcen", "sisa", "buren", "mukun"]);
    for (const h of ["janggu_kung", "janggu_deok", "janggu_gi", "janggu_deong", "buk", "buk_rim", "kkwaeng", "kkwaeng_mute", "sanba", "sanba_roll", "eisa_don", "eisa_rim", "paranku", "yemcen", "yemcen_edge", "sisa", "sisa_shake"])
      expect(REGIONAL_DRUMS[h], h).toBeTruthy();
  });
});

describe("朝鲜", () => {
  it("伽倻琴与玄琴的弄弦（!vib!）比别的拨弦深、慢；玄琴最深最慢", () => {
    for (const k of ["gayageum", "geomungo"]) {
      const i = inst(k);
      if (i.kind !== "pluck" || !i.vib) throw new Error(k);
      expect(i.vib.depth, k).toBeGreaterThan(PLUCK_VIB.depth * 2.5);
      expect(i.vib.rate, k).toBeLessThan(PLUCK_VIB.rate);
    }
    const g = inst("gayageum");
    const m = inst("geomungo");
    if (g.kind !== "pluck" || m.kind !== "pluck") throw new Error("pluck");
    expect(m.vib!.depth).toBeGreaterThan(g.vib!.depth);
    expect(m.vib!.rate).toBeLessThan(g.vib!.rate);
  });

  it("伽倻琴用指肉弹：起音的 3 kHz 以上比日本的筝（象牙爪）少得多", () => {
    const f = hz(64);
    const head = (k: string) => 1 - lowShare(pluck(pluckSpec(k), f, SR, 3), 3000, 0, Math.floor(0.05 * SR));
    expect(head("gayageum")).toBeLessThan(head("koto") * 0.5);
  });

  it("玄琴：竹片打在皮垫上的一声在 165 Hz 附近；声音低沉，同一个音 400 Hz 以下的能量比日本的筝多一倍以上、比乌德琴还多", () => {
    const spec = pluckSpec("geomungo");
    const f = hz(45);
    expect(power(pluck(spec, f, SR, 2), 165, 0, 0.05)).toBeGreaterThan(power(pluck({ ...spec, skin: undefined }, f, SR, 2), 165, 0, 0.05) * 1.4);
    const low = (s: PluckSpec) => lowShare(pluck(s, f, SR, 2), 400);
    expect(low(spec)).toBeGreaterThan(low(pluckSpec("koto")) * 2);
    const oud = CORE_INSTRUMENTS.oud;
    if (oud.kind !== "pluck") throw new Error("oud");
    expect(low(spec)).toBeGreaterThan(low(oud.spec));
  });

  it("奚琴是弓弦：没有指板，滑音比二胡长、音准游移更大，弓噪（跟着波形的噪声）更重", () => {
    const h = sustain("haegeum");
    const e = sustain("erhu");
    expect(h.kind).toBe("bowed");
    expect(h.glide).toBeGreaterThan(e.glide);
    expect(h.drift ?? 0).toBeGreaterThan(e.drift ?? 0);
    expect(h.pulse!.level).toBeGreaterThan(e.pulse!.level);
    expect(h.vibBoost ?? 2.2).toBeGreaterThan(2.2);
  });

  it("大笒：膜的“嗡”（跟着波形的噪声在四倍频）比气声响，气比梆笛多得多；长音鼓起来、尾巴深揉", () => {
    const d = sustain("daegeum");
    const b = sustain("bangdi");
    expect(d.pulse!.ratio).toBeGreaterThanOrEqual(4);
    expect(d.pulse!.level).toBeGreaterThan(d.breath!.level);
    expect(d.breath!.level).toBeGreaterThan(b.breath!.level * 2);
    expect(d.tremor!.depth).toBeGreaterThan(0.1);
    expect(d.vibBoost ?? 2.2).toBeGreaterThanOrEqual(3);
  });

  it("觱篥是圆柱管：奇次谐波比同样的锥形双簧（筚篥）占得多；太平箫与觱篥都比竹笛（箫、尺八）亮得多", () => {
    const ratio = (k: string, n: number, f0 = 330) => sustain(k).amps(n, n * f0) / sustain(k).amps(1, f0);
    const oddEven = (k: string) => [3, 5, 7].reduce((s, n) => s + ratio(k, n), 0) / [2, 4, 6].reduce((s, n) => s + ratio(k, n), 0);
    expect(oddEven("piri")).toBeGreaterThan(oddEven("hichiriki") * 1.3);
    // 大笒不算：它的膜让四倍频一带的谐波也很响（见上一项）
    const bright = (k: string) => [6, 8, 10].reduce((s, n) => s + ratio(k, n, 440), 0);
    for (const k of ["piri", "taepyeongso"]) for (const flute of ["xiao", "shakuhachi"]) expect(bright(k), `${k} 对 ${flute}`).toBeGreaterThan(bright(flute) * 3);
  });

  it("杖鼓：左面（쿵）低、右面（덕）高，两面一起（덩）两头都有", () => {
    const kung = drum(REGIONAL_DRUMS.janggu_kung, SR, 1);
    const deok = drum(REGIONAL_DRUMS.janggu_deok, SR, 1);
    const deong = drum(REGIONAL_DRUMS.janggu_deong, SR, 1);
    expect(lowShare(kung, 250)).toBeGreaterThan(0.6);
    expect(lowShare(deok, 250)).toBeLessThan(0.2);
    expect(lowShare(kung, 250)).toBeGreaterThan(lowShare(deok, 250) * 4);
    expect(lowShare(deong, 250)).toBeGreaterThan(0.3);
    // 덩的头 30 毫秒里竹片的“덕”清楚地在：1.5 kHz 以上比单打左面多几倍
    const crack = (x: Float32Array) => 1 - lowShare(x, 1500, 0, Math.floor(0.03 * SR));
    expect(crack(deong)).toBeGreaterThan(crack(kung) * 3);
  });

  it("鼓（북）在低处，打鼓身是高的“哒”；小金又亮又尖，按住的一下比开着敲短得多", () => {
    expect(lowShare(drum(REGIONAL_DRUMS.buk, SR, 1), 250)).toBeGreaterThan(0.7);
    expect(lowShare(drum(REGIONAL_DRUMS.buk_rim, SR, 1), 500)).toBeLessThan(0.3);
    const open = drum(REGIONAL_DRUMS.kkwaeng, SR, 1);
    const mute = drum(REGIONAL_DRUMS.kkwaeng_mute, SR, 1);
    expect(lowShare(open, 500)).toBeLessThan(0.15);
    expect(open.length).toBeGreaterThan(mute.length * 3);
  });

  it("钲：低、余音长，几个分音一涨一落地拍，音高不沉也不翘（与京剧的大锣不同）", () => {
    const f = hz(45);
    const x = mallet(malletSpec("jing"), f, SR, 4);
    expect(x.length / SR).toBeGreaterThan(5);
    expect(lowShare(x, 400)).toBeGreaterThan(0.6);
    const early = peakFreq(x, 0.05, 0.4, f * 0.9, f * 1.1, 0.5);
    const late = peakFreq(x, 1.5, 2.5, f * 0.9, f * 1.1, 0.5);
    expect(Math.abs(early / late - 1)).toBeLessThan(0.01);
    const rms = envelope(x, 20).slice(50, 150);
    expect(Math.min(...rms) / Math.max(...rms)).toBeLessThan(0.6);
  });
});

describe("琉球", () => {
  it("三线没有三味线的 sawari（不“嗞”），有拨子碰到蛇皮的一下", () => {
    const s = pluckSpec("sanshin");
    expect(s.buzz).toBeUndefined();
    expect(pluckSpec("shamisen").buzz).toBeTruthy();
    const f = hz(60);
    expect(power(pluck(s, f, SR, 2), 300, 0, 0.05)).toBeGreaterThan(power(pluck({ ...s, skin: undefined }, f, SR, 2), 300, 0, 0.05) * 1.2);
  });

  it("胡弓是弓弦，带滑音；指笛几乎是纯音", () => {
    expect(sustain("kucho").kind).toBe("bowed");
    expect(sustain("kucho").glide).toBeGreaterThan(0.05);
    const w = sustain("yubibue");
    for (let n = 2; n <= 4; n++) expect(w.amps(n, n * 2000) / w.amps(1, 2000), `${n}`).toBeLessThan(0.07);
  });

  it("三板：几片木头先后碰上，一下里有好几个“咔”；大太鼓在低处，手鼓干而短", () => {
    const x = drum(REGIONAL_DRUMS.sanba, SR, 3);
    const env = envelope(x, 1);
    const top = Math.max(...env);
    let onsets = 0;
    for (let i = 1; i < env.length; i++) if (env[i] > top * 0.3 && env[i] > env[i - 1] * 1.8) onsets++;
    expect(onsets).toBeGreaterThanOrEqual(2);
    expect(lowShare(x, 1000)).toBeLessThan(0.15);
    expect(lowShare(drum(REGIONAL_DRUMS.eisa_don, SR, 1), 250)).toBeGreaterThan(0.7);
    const p = drum(REGIONAL_DRUMS.paranku, SR, 1);
    expect(p.length / SR).toBeLessThan(0.4);
    expect(lowShare(p, 250)).toBeLessThan(0.5);
  });
});

describe("女真与满洲", () => {
  it("神鼓：鼓心低沉，握手上的铁环在鼓声后面“哗啦”（去掉铁环，0.1–0.3 秒的高频少得多）", () => {
    const spec = REGIONAL_DRUMS.yemcen;
    const x = drum(spec, SR, 2);
    expect(lowShare(x, 300)).toBeGreaterThan(0.5);
    const noRings = drum({ ...spec, layers: spec.layers.filter((l) => !(l.kind === "noise" && (l.taps ?? 1) > 1)) }, SR, 2);
    const hi = (y: Float32Array) => (1 - lowShare(y, 2500, Math.floor(0.1 * SR), Math.floor(0.3 * SR))) * energy(y, Math.floor(0.1 * SR), Math.floor(0.3 * SR));
    expect(hi(x)).toBeGreaterThan(hi(noRings) * 4);
  });

  it("腰铃：先涌起来再散开（最响处在起音后 10 毫秒以后），高频为主，余音超过 0.4 秒", () => {
    const x = drum(REGIONAL_DRUMS.sisa, SR, 5);
    const env = envelope(x, 2);
    const at = env.indexOf(Math.max(...env)) * 2;
    expect(at).toBeGreaterThan(10);
    expect(lowShare(x, 1500)).toBeLessThan(0.3);
    expect(x.length / SR).toBeGreaterThan(0.4);
  });

  it("号角：铜管一类，比玛雅的海螺号更暗（高次谐波少）", () => {
    const ratio = (k: string, n: number, f0 = 110) => sustain(k).amps(n, n * f0) / sustain(k).amps(1, f0);
    const top = (k: string) => [12, 16, 20].reduce((s, n) => s + ratio(k, n), 0);
    expect(sustain("buren").kind).toBe("brass");
    expect(top("buren")).toBeLessThan(top("conch") * 0.7);
  });

  it("口弦：簧片总在 G2 上嗡（奏 D5 与 G5 时 98 Hz 一样响），最响的泛音是所奏的那一个；F5 落在偏低的第七泛音（686 Hz）上", () => {
    const spec = malletSpec("mukun");
    expect(spec.drone?.hz).toBe(98);
    const d5 = mallet(spec, hz(74), SR, 1);
    const g5 = mallet(spec, hz(79), SR, 1);
    expect(peak(d5)).toBeCloseTo(0.8, 1);
    expect(peakFreq(d5, 0.1, 0.5, 300, 1300, 2)).toBeCloseTo(588, -1);
    expect(peakFreq(g5, 0.1, 0.5, 300, 1300, 2)).toBeCloseTo(784, -1);
    const droneD = power(d5, 98, 0.05, 0.4);
    const droneG = power(g5, 98, 0.05, 0.4);
    expect(droneD).toBeGreaterThan(0);
    expect(droneD / droneG).toBeGreaterThan(0.5);
    expect(droneD / droneG).toBeLessThan(2);
    // 被挑出来的泛音比簧片的基音响
    expect(power(d5, 588, 0.05, 0.4)).toBeGreaterThan(droneD * 2);
    const f5 = mallet(spec, hz(77), SR, 1);
    expect(Math.abs(peakFreq(f5, 0.1, 0.5, 600, 760, 1) - 686)).toBeLessThan(4);
    // 没有写 drone 的击奏乐器照旧（钲）：分音按所奏的音高
    expect(malletSpec("jing").drone).toBeUndefined();
  });
});
