// 地方乐器第二阶段：中南半岛与菲律宾（暹罗、缅甸、大越、菲律宾南部）与爪哇宫廷的软合奏。
// 登记；每件乐器确定、没有非数、峰值归一；合成出来的声音各有其“签名”——
// 高音木琴比甘邦亮、低音木琴余音长，三种乳锣（孔旺艾、锣圈、库林唐）的第二分音各在自己的位置、都不同于博南，
// 鼓圈的鼓有音高、起音略高再落稳，阿贡低而长、起音略高，独弦琴近乎正弦、檀筝又亮又薄，
// 双簧管（皮奈、赫奈）比竹笛亮得多，索乌胡琴比二胡暗，钦与锡长鸣、恰与瓦一碰就收，大鼓低、小件高，木鱼与饭鼓有音高。
import { describe, expect, it } from "vitest";
import { drum, mallet, peak, pluck, type MalletSpec, type PluckSpec } from "../../dsp";
import { INSTRUMENTS, type Instrument, type SustainSpec } from "../../instruments";
import { REGIONAL, REGIONAL_DRUMS, REGIONAL_INSTRUMENTS, regionalId } from ".";

const SR = 44100;
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** 这一阶段新加的乐器（有键的）与鼓点。 */
const KEYS = {
  siam: ["ranat_ek", "ranat_thum", "khong_wong", "pi_nai", "khlui", "saw_u"],
  burma: ["pat_waing", "kyi_waing", "hne", "saung_gauk"],
  vietnam: ["dan_tranh", "dan_bau", "dan_nguyet", "sao_truc"],
  philippines: ["kulintang", "agung", "gandingan", "kudyapi"],
  nusantara: ["gambang", "siter", "slenthem", "kethuk"],
} as const;
const HITS = {
  siam: ["ching", "chap", "taphon_tup", "taphon_pa", "taphon_ting", "klong_that", "klong_that_hi"],
  burma: ["si", "wa", "pat_ma"],
  vietnam: ["phach", "mo", "trong_com", "trong_com_tac"],
  philippines: ["babendil", "babendil_mute", "dabakan", "dabakan_rim"],
  nusantara: ["terbang_dung", "terbang_tak", "terbang_tung"],
} as const;
const ALL_KEYS = Object.values(KEYS).flat();
const ALL_HITS = Object.values(HITS).flat();

function same(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
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
  const i = INSTRUMENTS[key];
  if (!i || i.kind === "pluck" || i.kind === "mallet" || i.kind === "perc") throw new Error(key);
  return i;
}
/** 一件乐器在某音高的一个音（拨弦或击奏）。 */
function tone(key: string, m: number, seed = 3): Float32Array {
  const i = inst(key);
  if (i.kind === "pluck") return pluck(i.spec, hz(m), SR, seed);
  if (i.kind === "mallet") return mallet(i.spec, hz(m), SR, seed);
  throw new Error(key);
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
/** [t0, t1) 秒里功率最大的频率（lo–hi Hz，按 step Hz 扫）。 */
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
/** [t0, t1) 秒里第 6 次及以上谐波占前 40 个谐波的能量比例。 */
function highShare(x: Float32Array, f: number, t0: number, t1: number): number {
  let lo = 0,
    hi = 0;
  for (let k = 1; k <= 40 && k * f < SR / 2.2; k++) {
    const p = power(x, k * f, t0, t1);
    if (k >= 6) hi += p;
    else lo += p;
  }
  return hi / (lo + hi);
}
/** 一阶低通把信号分成 f 以下与以上：低处的能量比例。 */
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
/** 亮度：一阶差分的能量与信号能量之比（约等于平均的频率平方，越亮越大）。 */
function brightness(x: Float32Array): number {
  let d = 0,
    e = 0;
  for (let n = 1; n < x.length; n++) {
    d += (x[n] - x[n - 1]) ** 2;
    e += x[n] * x[n];
  }
  return d / e;
}
/** 自相关求基频（lo–hi Hz 之间）。 */
function pitchOf(x: Float32Array, from: number, len: number, lo: number, hi: number): number {
  let best = -Infinity;
  let bestLag = 1;
  for (let lag = Math.floor(SR / hi); lag < Math.floor(SR / lo); lag++) {
    let s = 0;
    for (let n = from; n < from + len; n++) s += x[n] * x[n + lag];
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  return SR / bestLag;
}
/** 包络（10 毫秒窗口的均方根）从最大处降 40 dB 所用的秒数。 */
function t40(x: Float32Array): number {
  const win = Math.floor(0.01 * SR);
  const env: number[] = [];
  for (let a = 0; a + win <= x.length; a += win) {
    let s = 0;
    for (let n = a; n < a + win; n++) s += x[n] * x[n];
    env.push(Math.sqrt(s / win));
  }
  const top = Math.max(...env);
  const at = env.indexOf(top);
  const end = env.findIndex((e, i) => i > at && e < top * 0.01);
  return ((end < 0 ? env.length : end) - at) * 0.01;
}

describe("第二阶段的地方乐器：登记", () => {
  it("暹罗、缅甸、大越、菲律宾各有自己的乐器（每个地区至少四件），爪哇宫廷的软合奏补了五件，键与鼓点都在表里", () => {
    for (const r of ["siam", "burma", "vietnam", "philippines"] as const) {
      expect(REGIONAL.filter((d) => d.region === r).length, r).toBeGreaterThanOrEqual(4);
      for (const k of KEYS[r]) expect(REGIONAL.find((d) => d.key === k)?.region, k).toBe(r);
      for (const h of HITS[r]) expect(REGIONAL.find((d) => d.drums && h in d.drums)?.region, h).toBe(r);
    }
    for (const k of KEYS.nusantara) expect(REGIONAL.find((d) => d.key === k)?.region, k).toBe("nusantara");
    for (const h of HITS.nusantara) expect(REGIONAL_DRUMS[h], h).toBeTruthy();
    for (const k of ALL_KEYS) expect(INSTRUMENTS[k], k).toBe(REGIONAL_INSTRUMENTS[k]);
  });

  it("每件都有中英文名与音色样本", () => {
    const mine = REGIONAL.filter((d) => (d.key && (ALL_KEYS as readonly string[]).includes(d.key)) || Object.keys(d.drums ?? {}).some((h) => (ALL_HITS as readonly string[]).includes(h)));
    expect(mine.length).toBe(33);
    for (const d of mine) {
      expect(d.name.zh.length, regionalId(d)).toBeGreaterThan(0);
      expect(d.name.en.length, regionalId(d)).toBeGreaterThan(0);
      expect(d.demo.abc || d.demo.drum, regionalId(d)).toBeTruthy();
    }
  });
});

describe("第二阶段的地方乐器：合成", () => {
  for (const k of ALL_KEYS) {
    const kind = REGIONAL_INSTRUMENTS[k]?.kind;
    if (kind !== "pluck" && kind !== "mallet") continue;
    it(`${k}：确定、没有非数、峰值归一`, () => {
      const x = tone(k, 60);
      expect(x.every(Number.isFinite), k).toBe(true);
      expect(peak(x), k).toBeCloseTo(0.8, 1);
      expect(same(tone(k, 60), x), k).toBe(true);
    });
  }

  for (const h of ALL_HITS) {
    it(`${h}：确定、没有非数、峰值归一、不超过 3 秒`, () => {
      const x = drum(REGIONAL_DRUMS[h], SR, 5);
      expect(x.every(Number.isFinite), h).toBe(true);
      expect(peak(x), h).toBeCloseTo(0.8, 1);
      expect(x.length / SR, h).toBeLessThan(3.1);
      expect(same(drum(REGIONAL_DRUMS[h], SR, 5), x), h).toBe(true);
    });
  }

  it("吹奏与弓弦：谐波表有限、非负、基频不为零；音量校准在合理范围", () => {
    for (const k of ["pi_nai", "khlui", "saw_u", "hne", "sao_truc"]) {
      const s = sustain(k);
      expect(s.level, k).toBeGreaterThan(0.05);
      expect(s.level, k).toBeLessThan(1);
      for (const f0 of [131, 262, 523, 1047]) {
        const amps = Array.from({ length: 24 }, (_, i) => s.amps(i + 1, (i + 1) * f0));
        expect(amps.every((a) => Number.isFinite(a) && a >= 0), `${k} ${f0}`).toBe(true);
        expect(amps[0], `${k} ${f0}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("第二阶段的地方乐器：各自的签名", () => {
  it("木琴：拉那·艾（硬槌）比甘邦（软槌）亮得多，两者都短；拉那·通的余音比拉那·艾长；拉那两件会滚奏（kro）", () => {
    const ek = tone("ranat_ek", 72);
    const gb = tone("gambang", 72);
    expect(brightness(ek)).toBeGreaterThan(brightness(gb) * 1.5);
    expect(t40(ek)).toBeLessThan(1.2);
    expect(t40(gb)).toBeLessThan(1.2);
    expect(t40(tone("ranat_thum", 60))).toBeGreaterThan(t40(tone("ranat_ek", 60)) * 1.3);
    for (const k of ["ranat_ek", "ranat_thum"]) {
      const i = inst(k);
      expect(i.kind === "mallet" && (i.roll ?? 0) > 10, k).toBe(true);
    }
  });

  it("三种乳锣的第二分音各在自己的位置：孔旺艾 2.32 倍、锣圈 2.55 倍、库林唐 2.62 倍，都不同于博南（2.76 倍）", () => {
    const f = hz(55);
    const at = (k: string, r: number) => power(mallet(k === "bonang" ? (INSTRUMENTS.bonang as { spec: MalletSpec }).spec : malletSpec(k), f, SR, 2), r * f, 0.05, 0.6);
    const want: Record<string, number> = { khong_wong: 2.32, kyi_waing: 2.55, kulintang: 2.62 };
    for (const [k, r] of Object.entries(want)) {
      for (const other of [2.32, 2.55, 2.62, 2.76].filter((o) => o !== r)) expect(at(k, r), `${k}：${r} 对 ${other}`).toBeGreaterThan(at(k, other) * 4);
    }
    expect(at("bonang", 2.76)).toBeGreaterThan(at("bonang", 2.32) * 4);
  });

  it("鼓圈：每只鼓有音高（第二分音在 1.98 倍），起音略高、很快落稳；手掌按住的滑音写 !fall! / !bend!", () => {
    const f = hz(48);
    const x = mallet(malletSpec("pat_waing"), f, SR, 4);
    const second = peakFreq(x, 0.02, 0.3, 1.8 * f, 2.2 * f);
    expect(Math.abs(second / (1.98 * f) - 1), `${second} Hz`).toBeLessThan(0.02);
    const early = pitchOf(x, 50, 900, 100, 200);
    const late = pitchOf(x, Math.floor(0.25 * SR), 4000, 100, 200);
    expect(early).toBeGreaterThan(late * 1.012);
    expect(Math.abs(1200 * Math.log2(late / f))).toBeLessThan(25);
  });

  it("阿贡：低（250 Hz 以下占四分之三以上）、余音长，起音略高一点慢慢落稳；甘丁甘与克图敲完就按住", () => {
    const f = hz(43);
    const x = mallet(malletSpec("agung"), f, SR, 4);
    expect(lowShare(x, 250)).toBeGreaterThan(0.75);
    expect(x.length / SR).toBeGreaterThan(3);
    expect(pitchOf(x, 400, 2000, 80, 120)).toBeGreaterThan(pitchOf(x, SR, 4000, 80, 120) * 1.004);
    for (const k of ["gandingan", "kethuk"]) {
      const i = inst(k);
      expect(i.kind === "mallet" && (i.release ?? 1) < 0.5, k).toBe(true);
    }
    expect(mallet(malletSpec("kethuk"), hz(55), SR, 1).length / SR).toBeLessThan(1);
  });

  it("独弦琴近乎正弦（泛音），檀筝又亮又薄（比日本的筝亮），弯琴比檀筝暗；月琴的余音比檀筝短", () => {
    const f = hz(64);
    const bau = highShare(pluck(pluckSpec("dan_bau"), f, SR, 2), f, 0.3, 0.6);
    const tranh = highShare(pluck(pluckSpec("dan_tranh"), f, SR, 2), f, 0.3, 0.6);
    const koto = highShare(pluck((INSTRUMENTS.koto as { spec: PluckSpec }).spec, f, SR, 2), f, 0.3, 0.6);
    const saung = highShare(pluck(pluckSpec("saung_gauk"), f, SR, 2), f, 0.3, 0.6);
    expect(bau, `独弦琴 ${bau.toFixed(3)}`).toBeLessThan(0.02);
    expect(tranh, `檀筝 ${tranh.toFixed(3)} 对筝 ${koto.toFixed(3)}`).toBeGreaterThan(koto * 1.2);
    expect(saung, `弯琴 ${saung.toFixed(3)}`).toBeLessThan(tranh * 0.7);
    expect(t40(tone("dan_nguyet", 64))).toBeLessThan(t40(tone("dan_tranh", 64)) * 0.75);
  });

  it("西特是复弦、一放就按住；库迪亚皮的音高准", () => {
    expect(pluckSpec("siter").course).toBeGreaterThan(0);
    const s = inst("siter");
    expect(s.kind === "pluck" && (s.release ?? 1) < 0.3).toBe(true);
    const f = hz(57);
    const x = pluck(pluckSpec("kudyapi"), f, SR, 2);
    expect(Math.abs(1200 * Math.log2(pitchOf(x, 4000, 3000, f * 0.6, f * 1.6) / f))).toBeLessThan(25);
  });

  it("双簧管（皮奈、赫奈）比竹笛（克卢伊、越南竹笛）亮得多，赫奈（铜喇叭口）比皮奈亮；克卢伊的笛膜在五倍频上“沙”", () => {
    const ratio = (k: string, n: number, f0 = 440) => sustain(k).amps(n, n * f0) / sustain(k).amps(1, f0);
    const bright = (k: string) => [6, 8, 10].reduce((s, n) => s + ratio(k, n), 0);
    for (const reed of ["pi_nai", "hne"]) for (const flute of ["khlui", "sao_truc"]) expect(bright(reed), `${reed} 对 ${flute}`).toBeGreaterThan(bright(flute) * 3);
    expect(bright("hne")).toBeGreaterThan(bright("pi_nai"));
    expect(sustain("khlui").pulse!.ratio).toBeGreaterThanOrEqual(4);
    expect(sustain("sao_truc").pulse!.ratio).toBeLessThan(4);
  });

  it("索乌（椰壳胡琴）比二胡、雷巴布暗；是弓弦，滑音比提琴长", () => {
    const upper = (k: string, f0 = 196) => [6, 8, 10, 12].reduce((s, n) => s + sustain(k).amps(n, n * f0), 0) / sustain(k).amps(1, f0);
    expect(upper("saw_u")).toBeLessThan(upper("erhu") * 0.6);
    expect(upper("saw_u")).toBeLessThan(upper("rebab") * 0.8);
    expect(sustain("saw_u").kind).toBe("bowed");
    expect(sustain("saw_u").glide).toBeGreaterThan(0.05);
  });

  it("钦与锡长鸣、恰与瓦一碰就收，都在高处；大桶鼓、帕玛、塔蓬的“通”、特尔班的“咚”在低处；巴本迪尔、达巴坎的鼓边、拍板在高处", () => {
    const x = (h: string) => drum(REGIONAL_DRUMS[h], SR, 1);
    for (const h of ["ching", "si"]) expect(x(h).length / SR, h).toBeGreaterThan(0.8);
    for (const h of ["chap", "wa"]) expect(x(h).length / SR, h).toBeLessThan(0.3);
    for (const h of ["ching", "chap", "si"]) expect(lowShare(x(h), 1000), h).toBeLessThan(0.15);
    for (const h of ["klong_that", "pat_ma", "taphon_tup", "terbang_dung"]) expect(lowShare(x(h), 250), h).toBeGreaterThan(0.6);
    for (const h of ["babendil", "dabakan_rim", "phach", "wa"]) expect(lowShare(x(h), 500), h).toBeLessThan(0.3);
  });

  it("木鱼、饭鼓、塔蓬的“叮”有音高（约 660、180、390 Hz）", () => {
    const f = (h: string, lo: number, hi: number) => peakFreq(drum(REGIONAL_DRUMS[h], SR, 1), 0.01, 0.15, lo, hi, 2);
    expect(Math.abs(f("mo", 500, 900) / 662 - 1)).toBeLessThan(0.05);
    expect(Math.abs(f("trong_com", 140, 240) / 180 - 1)).toBeLessThan(0.06);
    expect(Math.abs(f("taphon_ting", 300, 500) / 391 - 1)).toBeLessThan(0.05);
  });
});
