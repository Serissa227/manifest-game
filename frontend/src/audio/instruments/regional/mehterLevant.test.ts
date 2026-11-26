// 地方乐器第二阶段·奥斯曼军乐（梅赫特）与爱琴海、黎凡特：克斯大鼓、纳卡雷、齐尔、博鲁号、杰夫根、爱琴海里拉琴、劳托、布祖克。
// 登记与音色样本（逐件的确定、无非数、峰值、音域由 regional.test.ts 的通用检查覆盖），这里查各自的声音特征：
// 克斯低沉而余音长、两只一高一低；纳卡雷有音高、短而高；齐尔亮而长、闷击短；杰夫根的小铃连响几下；
// 博鲁比圆号亮、样本只吹泛音列上的音；里拉琴的弓噪比克曼切与提琴重；劳托的八度弦、布祖克比乌德琴亮而长。
import { describe, expect, it } from "vitest";
import { drum, pluck, type DrumSpec, type PluckSpec } from "../../dsp";
import { DRUMS, INSTRUMENTS, type Instrument, type SustainSpec } from "../../instruments";
import { pc } from "../../theory";
import { realizePass } from "../../score";
import { demoTrack, REGIONAL, REGIONAL_DRUMS, REGIONAL_INSTRUMENTS, regionalId } from ".";

const SR = 44100;
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function inst(key: string): Instrument {
  const i = INSTRUMENTS[key];
  if (!i) throw new Error(key);
  return i;
}
function pluckSpec(key: string): PluckSpec {
  const i = inst(key);
  if (i.kind !== "pluck") throw new Error(key);
  return i.spec;
}
function sustain(key: string): SustainSpec {
  const i = inst(key);
  if (i.kind === "pluck" || i.kind === "mallet" || i.kind === "perc") throw new Error(key);
  return i;
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

function energy(x: Float32Array, t0: number, t1: number): number {
  const a = Math.floor(t0 * SR);
  const b = Math.min(x.length, Math.floor(t1 * SR));
  let e = 0;
  for (let n = a; n < b; n++) e += x[n] * x[n];
  return e / Math.max(1, b - a);
}

const hit = (name: string, seed = 1) => drum(REGIONAL_DRUMS[name], SR, seed);

describe("登记：奥斯曼军乐与爱琴海、黎凡特的八件", () => {
  const ids = ["kos", "nakkare_hi", "zil", "boru", "cevgen", "lyra", "laouto", "buzuq"];

  it("都在 REGIONAL 里、算奥斯曼一带，中英文名、音色样本齐全；有音高的进了乐器表，打击乐的鼓点进了鼓点表", () => {
    for (const id of ids) {
      const d = REGIONAL.find((r) => regionalId(r) === id);
      expect(d, id).toBeTruthy();
      expect(d!.region, id).toBe("ottoman");
      expect(d!.name.zh.length * d!.name.en.length, id).toBeGreaterThan(0);
    }
    expect(inst("boru").kind).toBe("brass");
    expect(inst("lyra").kind).toBe("bowed");
    expect(inst("laouto").kind).toBe("pluck");
    expect(inst("buzuq").kind).toBe("pluck");
    for (const k of ["boru", "lyra", "laouto", "buzuq"]) expect(INSTRUMENTS[k]).toBe(REGIONAL_INSTRUMENTS[k]);
    for (const h of ["kos", "kos_hi", "nakkare_hi", "nakkare_lo", "zil", "zil_mute", "cevgen", "cevgen_tap"]) expect(DRUMS[h], h).toBe(REGIONAL_DRUMS[h]);
  });

  it("新的鼓点逐个确定、没有非数（不同的变体种子略有差别）", () => {
    for (const h of ["kos", "kos_hi", "nakkare_hi", "nakkare_lo", "zil", "zil_mute", "cevgen", "cevgen_tap"]) {
      const a = hit(h, 3);
      const b = hit(h, 3);
      expect(a.every(Number.isFinite), h).toBe(true);
      expect(a.length, h).toBe(b.length);
      expect(a.every((v, i) => v === b[i]), h).toBe(true);
      expect(hit(h, 4).some((v, i) => v !== a[i]), h).toBe(true);
    }
  });
});

describe("梅赫特的打击乐", () => {
  it("克斯大鼓：九成以上的能量在 250 Hz 以下，主音约 52 Hz，两秒以后还在响；小的一只更高", () => {
    const k = hit("kos");
    expect(lowShare(k, 250)).toBeGreaterThan(0.9);
    const f = peakFreq(k, 0.3, 1.0, 40, 80);
    expect(f).toBeGreaterThan(47);
    expect(f).toBeLessThan(58);
    expect(k.length / SR).toBeGreaterThan(2);
    expect(energy(k, 1.5, 1.8)).toBeGreaterThan(energy(k, 0, 0.3) * 0.00005);
    const hi = hit("kos_hi");
    expect(peakFreq(hi, 0.3, 1.0, 40, 100)).toBeGreaterThan(f * 1.15);
    // 与达乌尔的“咚”比：克斯更低、更长
    const davul = drum(DRUMS.davul_dum, SR, 1);
    expect(k.length).toBeGreaterThan(davul.length * 2);
  });

  it("纳卡雷：一高一低两只都有音高（约 330 Hz 与 228 Hz），短（半秒以内）", () => {
    const h = hit("nakkare_hi");
    const l = hit("nakkare_lo");
    const fh = peakFreq(h, 0.02, 0.15, 250, 420);
    const fl = peakFreq(l, 0.02, 0.15, 180, 300);
    expect(Math.abs(fh - 330)).toBeLessThan(20);
    expect(Math.abs(fl - 228)).toBeLessThan(15);
    expect(h.length / SR).toBeLessThan(0.5);
    expect(l.length / SR).toBeLessThan(0.5);
  });

  it("齐尔大钹：高频为主、余音两秒多（比原有的小钹与明的铙钹长得多）；合住的闷击短得多", () => {
    const z = hit("zil");
    expect(lowShare(z, 1500)).toBeLessThan(0.25);
    expect(z.length / SR).toBeGreaterThan(2);
    const tail = (x: Float32Array) => energy(x, 0.8, 1.0) / energy(x, 0, 0.2);
    expect(tail(z)).toBeGreaterThan(tail(drum(DRUMS.cymbal, SR, 1)) * 3);
    expect(tail(z)).toBeGreaterThan(tail(drum(DRUMS.bo, SR, 1)) * 3);
    expect(hit("zil_mute").length / SR).toBeLessThan(0.3);
  });

  it("杰夫根响杖：小铃连着响好几下（去掉连响只剩一下时，40–150 毫秒里的声音少得多），高频为主", () => {
    const spec = REGIONAL_DRUMS.cevgen;
    const one: DrumSpec = { ...spec, layers: spec.layers.map((l) => (l.kind === "noise" ? { ...l, taps: 1 } : l)) };
    const c = hit("cevgen", 2);
    expect(energy(c, 0.04, 0.15)).toBeGreaterThan(energy(drum(one, SR, 2), 0.04, 0.15) * 1.5);
    expect(lowShare(c, 2000)).toBeLessThan(0.3);
  });
});

describe("博鲁号与爱琴海的里拉琴", () => {
  const ratio = (k: string, n: number, f0 = 440) => sustain(k).amps(n, n * f0) / sustain(k).amps(1, f0);
  const bright = (k: string) => [6, 8, 10].reduce((s, n) => s + ratio(k, n), 0);

  it("博鲁：铜管，比圆号亮得多、比海螺号亮；音色样本只吹 D 号泛音列上的音（D、升F、A、C）", () => {
    expect(sustain("boru").kind).toBe("brass");
    expect(bright("boru")).toBeGreaterThan(bright("horn") * 2);
    expect(bright("boru")).toBeGreaterThan(bright("conch") * 2);
    const def = REGIONAL.find((d) => d.key === "boru")!;
    const notes = realizePass(demoTrack(def), 0).events;
    for (const e of notes) expect([0, 2, 6, 9], `${e.m}`).toContain(pc(e.m));
  });

  it("里拉琴：弓弦，弓贴着弦的沙（跟着波形的噪声）比克曼切、提琴重，滑音比提琴长，揉音比提琴快", () => {
    const lyra = sustain("lyra");
    expect(lyra.kind).toBe("bowed");
    expect(lyra.pulse!.level).toBeGreaterThan(sustain("kemence").pulse!.level);
    expect(lyra.pulse!.level).toBeGreaterThan((sustain("fiddle").pulse?.level ?? 0) + 0.05);
    expect(lyra.glide).toBeGreaterThan(sustain("fiddle").glide);
    expect(lyra.vib!.rate).toBeGreaterThan(sustain("fiddle").vib!.rate);
    // 鼻音：1.5 kHz 一带（440 Hz 的第三、四谐波附近）比 900 Hz 一带强
    expect(lyra.amps(3, 1320) / lyra.amps(2, 880)).toBeGreaterThan(sustain("fiddle").amps(3, 1320) / sustain("fiddle").amps(2, 880));
  });
});

describe("劳托与布祖克（钢丝复弦的长颈琉特）", () => {
  it("劳托：低音组里的八度弦让二倍频更响；钢丝弦比乌德琴的羊肠弦亮", () => {
    const spec = pluckSpec("laouto");
    const f = hz(57);
    const ratio = (s: PluckSpec) => {
      const x = pluck(s, f, SR, 4);
      return power(x, 2 * f, 0.05, 0.3) / power(x, f, 0.05, 0.3);
    };
    expect(ratio(spec)).toBeGreaterThan(ratio({ ...spec, octave: undefined }));
    expect(highShare(pluck(spec, f, SR, 4), f, 0.1, 0.3)).toBeGreaterThan(highShare(pluck(pluckSpec("ud"), f, SR, 4), f, 0.1, 0.3));
  });

  it("布祖克：比乌德琴亮、余音长，长音用快的拨片震音", () => {
    const spec = pluckSpec("buzuq");
    const ud = pluckSpec("ud");
    const f = hz(62);
    const b = pluck(spec, f, SR, 5);
    const u = pluck(ud, f, SR, 5);
    expect(highShare(b, f, 0.3, 0.5)).toBeGreaterThan(highShare(u, f, 0.3, 0.5) * 1.3);
    expect(spec.t60).toBeGreaterThan(ud.t60);
    expect(energy(b, 1.0, 1.3) / energy(b, 0, 0.2)).toBeGreaterThan(energy(u, 1.0, 1.3) / energy(u, 0, 0.2));
    const i = inst("buzuq");
    expect(i.kind === "pluck" && i.tremolo !== undefined && (i.tremRate ?? 0) >= 14).toBe(true);
  });

  it("两件的音高都准（复弦、八度弦不把音高带偏）", () => {
    for (const k of ["laouto", "buzuq"]) {
      for (const m of [50, 62, 69]) {
        const x = pluck(pluckSpec(k), hz(m), SR, 2);
        const f = peakFreq(x, 0.05, 0.4, hz(m) * 0.94, hz(m) * 1.06, 0.5);
        expect(Math.abs(1200 * Math.log2(f / hz(m))), `${k} ${m}`).toBeLessThan(20);
      }
    }
  });
});
