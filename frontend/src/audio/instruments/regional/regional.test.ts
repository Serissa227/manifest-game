// 地方乐器（第九批配乐·地方特色第一阶段）：登记、音色样本的曲谱，以及合成出来的声音的大致特征——
// 确定性、没有非数、峰值归一、音高准确、余音衰减；三味线与西塔琴的“嗡”让余音里的高次谐波留得更久，共鸣弦、琴皮、八度弦各有其声，
// 太鼓的能量在低频、拍子木在高频，锣的音高往上翘或往下沉，左手鼓推上去，甘美兰的锣“翁翁”地拍，拇指琴的铁环沙沙响；
// 吹奏与弓弦的谐波表（排箫只有奇次谐波、陶笛几乎是正弦、双簧管一族比笛子亮……）；编织式写法（排箫的轮吹、甘美兰的咬合）。
import { describe, expect, it } from "vitest";
import { badBars } from "../../abc";
import { bridge, drum, mallet, peak, pluck, type MalletSpec, type PluckSpec } from "../../dsp";
import { CORE_DRUMS, CORE_INSTRUMENTS, DRUMS, INSTRUMENTS, type Instrument, type SustainSpec } from "../../instruments";
import { barUnits, lineOf, realizePass } from "../../score";
import { beats, hocket, kotekan, punctuate, woven } from "../../tracks/weave";
import { demoTrack, REGIONAL, REGIONAL_DRUMS, REGIONAL_INSTRUMENTS, regionalId } from ".";

const SR = 44100;

/** 两段采样逐个相同（长的缓冲用 toEqual 太慢）。 */
function same(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
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

/** 自相关求基频（lo–hi Hz 之间）。 */
function pitchOf(x: Float32Array, from: number, len: number, lo = 50, hi = 2000): number {
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

/** 简单的频段能量比例：一阶滤波把信号分成 f 以下与以上（够区分“低频为主”“高频为主”）。 */
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

describe("地方乐器的登记", () => {
  it("每件都有地区、中英文名、音色样本；有键的有乐器参数，只有鼓点的有鼓点", () => {
    expect(REGIONAL.length).toBeGreaterThanOrEqual(60);
    for (const d of REGIONAL) {
      expect(d.name.zh.length, regionalId(d)).toBeGreaterThan(0);
      expect(d.name.en.length, regionalId(d)).toBeGreaterThan(0);
      expect(["japan", "ming", "ottoman", "india", "nusantara", "andes", "maya", "swahili", "iberia_italy", "north_europe", "arabia", "persia", "maghreb", "ethiopia", "kongo", "guinea", "siam", "burma", "vietnam", "philippines", "korea", "ryukyu", "jurchen", "mexica", "taino", "tupi", "pacific"]).toContain(d.region);
      if (d.key) expect(d.instrument, d.key).toBeTruthy();
      else expect(Object.keys(d.drums ?? {}).length, d.name.en).toBeGreaterThan(0);
      expect(d.demo.abc || d.demo.drum, regionalId(d)).toBeTruthy();
    }
    // 每个地区都至少三件（第一阶段八个；第二阶段的北欧、阿拉伯、波斯、马格里布、非洲三处……也是）
    for (const r of ["japan", "ming", "ottoman", "india", "nusantara", "andes", "maya", "swahili", "north_europe", "arabia", "persia", "maghreb", "ethiopia", "kongo", "guinea", "korea", "ryukyu", "jurchen", "pacific"]) expect(REGIONAL.filter((d) => d.region === r).length, r).toBeGreaterThanOrEqual(3);
  });

  it("键与鼓点名互不重复，也不与原有的乐器、鼓点重名；都合进了乐器表与鼓点表", () => {
    const keys = REGIONAL.flatMap((d) => (d.key ? [d.key] : []));
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) {
      expect(Object.prototype.hasOwnProperty.call(CORE_INSTRUMENTS, k), k).toBe(false);
      expect(INSTRUMENTS[k]).toBe(REGIONAL_INSTRUMENTS[k]);
    }
    const hits = REGIONAL.flatMap((d) => Object.keys(d.drums ?? {}));
    expect(new Set(hits).size).toBe(hits.length);
    for (const h of hits) {
      expect(Object.prototype.hasOwnProperty.call(CORE_DRUMS, h), h).toBe(false);
      expect(DRUMS[h]).toBe(REGIONAL_DRUMS[h]);
    }
  });

  for (const d of REGIONAL) {
    it(`${regionalId(d)}：音色样本的曲谱小节完整，展开后音高在合成乐器的音域里、鼓点都在，结果确定，一遍 5–16 秒（试听台另加 2.5 秒余音）`, () => {
      const t = demoTrack(d);
      const bar = barUnits(t.meter);
      if (d.demo.abc) expect(badBars(lineOf(t, "A", "m"), bar)).toEqual([]);
      const p = realizePass(t, 0);
      expect(p.events.length).toBeGreaterThan(0);
      expect(p.length).toBeGreaterThan(5);
      expect(p.length).toBeLessThan(16);
      for (const e of p.events) {
        if (e.hit) expect(DRUMS[e.hit], e.hit).toBeTruthy();
        else {
          expect(e.m).toBeGreaterThanOrEqual(26);
          expect(e.m).toBeLessThanOrEqual(100);
        }
      }
      expect(realizePass(t, 0)).toEqual(p);
    });
  }
});

describe("拨弦", () => {
  const plucks = Object.entries(REGIONAL_INSTRUMENTS).filter(([, i]) => i.kind === "pluck").map(([k]) => k);

  it("至少十件", () => expect(plucks.length).toBeGreaterThanOrEqual(10));

  for (const k of plucks) {
    it(`${k}：确定、没有非数、峰值归一、音高准确、余音逐渐衰减`, () => {
      const spec = pluckSpec(k);
      for (const m of [57, 64]) {
        const x = pluck(spec, hz(m), SR, 3);
        expect(x.every(Number.isFinite), k).toBe(true);
        expect(peak(x), k).toBeCloseTo(0.8, 1);
        expect(same(pluck(spec, hz(m), SR, 3), x)).toBe(true);
        const f = pitchOf(x, 4000, 3000, hz(m) * 0.6, hz(m) * 1.6);
        expect(Math.abs(1200 * Math.log2(f / hz(m))), `${k} ${m}：${f.toFixed(1)} Hz`).toBeLessThan(25);
        expect(energy(x, x.length - 2000, x.length), k).toBeLessThan(energy(x, 0, 4000) * 0.05);
      }
    });
  }

  it("琴桥的“嗡”只在一侧、越过阈值才碰", () => {
    expect(bridge(0.5, 0.3)).toBe(0);
    expect(bridge(-0.2, 0.3)).toBe(0);
    expect(bridge(-0.5, 0.3)).toBeCloseTo(0.2, 9);
  });

  it("三味线、琵琶（日本）、西塔琴、坦布拉：有“嗡”的余音里高次谐波留得更久", () => {
    for (const [k, m, t0, t1] of [["shamisen", 57, 0.3, 0.45], ["biwa", 52, 0.3, 0.45], ["sitar", 62, 0.7, 0.9], ["tanpura", 45, 1.5, 1.8]] as const) {
      const spec = pluckSpec(k);
      expect(spec.buzz, k).toBeTruthy();
      const f = hz(m);
      const withBuzz = highShare(pluck(spec, f, SR, 7), f, t0, t1);
      const without = highShare(pluck({ ...spec, buzz: undefined }, f, SR, 7), f, t0, t1);
      expect(withBuzz, `${k}：${withBuzz.toFixed(2)} 对 ${without.toFixed(2)}`).toBeGreaterThan(without * 1.3);
    }
  });

  it("西塔琴的共鸣弦：拨 D4 时，调在 E4 的共鸣弦也被带着响", () => {
    const spec = pluckSpec("sitar");
    const f = hz(62);
    const e4 = hz(64);
    const withSym = power(pluck(spec, f, SR, 5), e4, 0.5, 1.5);
    const without = power(pluck({ ...spec, sympathetic: undefined }, f, SR, 5), e4, 0.5, 1.5);
    expect(withSym).toBeGreaterThan(without * 4);
  });

  it("三味线的琴皮：拨子打在皮上的一声在 210 Hz 附近；恰朗戈的八度弦让二倍频更响", () => {
    const sham = pluckSpec("shamisen");
    const f = hz(64);
    expect(power(pluck(sham, f, SR, 2), 210, 0, 0.06)).toBeGreaterThan(power(pluck({ ...sham, skin: undefined }, f, SR, 2), 210, 0, 0.06) * 1.4);
    const ch = pluckSpec("charango");
    const g = hz(64);
    const ratio = (s: PluckSpec) => {
      const x = pluck(s, g, SR, 4);
      return power(x, 2 * g, 0.05, 0.3) / power(x, g, 0.05, 0.3);
    };
    expect(ratio(ch)).toBeGreaterThan(ratio({ ...ch, octave: undefined }));
  });

  it("琵琶与卡农琴、扬琴、桑图尔的长音是轮指（震音），琵琶按五个手指的轻重轮流", () => {
    for (const k of ["pipa", "kanun", "yangqin", "santoor"]) {
      const i = inst(k);
      expect(i.kind === "pluck" && i.tremolo !== undefined && (i.tremRate ?? 0) > 10, k).toBe(true);
    }
    const p = inst("pipa");
    expect(p.kind === "pluck" && p.tremPattern?.length).toBe(5);
  });
});

describe("击奏", () => {
  const mallets = Object.entries(REGIONAL_INSTRUMENTS).filter(([, i]) => i.kind === "mallet").map(([k]) => k);

  it("至少十件", () => expect(mallets.length).toBeGreaterThanOrEqual(10));

  for (const k of mallets) {
    it(`${k}：确定、没有非数、峰值归一`, () => {
      const x = mallet(malletSpec(k), 220, SR, 2);
      expect(x.every(Number.isFinite), k).toBe(true);
      expect(peak(x), k).toBeCloseTo(0.8, 1);
      expect(same(mallet(malletSpec(k), 220, SR, 2), x)).toBe(true);
    });
  }

  it("京剧的小锣敲下去音高往上翘，大锣往下沉", () => {
    const f = hz(77);
    const up = mallet(malletSpec("xiaoluo"), f, SR, 1);
    expect(peakFreq(up, 0, 0.05, f * 0.8, f * 1.1, 2)).toBeLessThan(peakFreq(up, 0.4, 0.6, f * 0.8, f * 1.1, 2) * 0.96);
    const g = hz(55);
    const down = mallet(malletSpec("daluo"), g, SR, 1);
    expect(peakFreq(down, 0, 0.08, g * 0.95, g * 1.12)).toBeGreaterThan(peakFreq(down, 1.2, 1.6, g * 0.95, g * 1.12) * 1.03);
  });

  it("甘美兰的大锣低沉、余音长，成对的音“翁翁”地拍（包络一涨一落）", () => {
    const x = mallet(malletSpec("gong_ageng"), hz(31), SR, 4);
    expect(x.length / SR).toBeGreaterThan(6);
    expect(lowShare(x, 250)).toBeGreaterThan(0.8);
    // 1–3 秒里 20 毫秒窗口的均方根有明显的起伏
    const win = Math.floor(0.02 * SR);
    const rms: number[] = [];
    for (let a = SR; a < 3 * SR; a += win) rms.push(Math.sqrt(energy(x, a, a + win)));
    const ratio = Math.min(...rms.slice(5, -5)) / Math.max(...rms.slice(5, -5));
    expect(ratio).toBeLessThan(0.6);
  });

  it("拇指琴的铁环：沙沙声让 2.5 kHz 以上更多", () => {
    const spec = malletSpec("kalimba");
    const a = mallet(spec, hz(65), SR, 6);
    const b = mallet({ ...spec, rattle: undefined }, hz(65), SR, 6);
    expect(1 - lowShare(a, 2500)).toBeGreaterThan((1 - lowShare(b, 2500)) * 3);
  });
});

describe("打击乐的鼓点", () => {
  for (const [hit, spec] of Object.entries(REGIONAL_DRUMS)) {
    it(`${hit}：确定、没有非数、峰值归一、不超过 3 秒`, () => {
      const x = drum(spec, SR, 9);
      expect(x.every(Number.isFinite), hit).toBe(true);
      expect(peak(x), hit).toBeCloseTo(0.8, 1);
      expect(x.length / SR, hit).toBeLessThan(3.1);
      expect(same(drum(spec, SR, 9), x)).toBe(true);
    });
  }

  it("太鼓、邦博鼓、达乌尔、姆松多的能量在低频；拍子木、板鼓、龟甲、铙钹在高处", () => {
    for (const h of ["taiko_don", "bombo", "davul_dum", "msondo"]) expect(lowShare(drum(REGIONAL_DRUMS[h], SR, 1), 250), h).toBeGreaterThan(0.7);
    for (const h of ["hyoshigi", "bangu", "ayotl_hi", "bo"]) expect(lowShare(drum(REGIONAL_DRUMS[h], SR, 1), 500), h).toBeLessThan(0.3);
  });

  it("塔布拉：右手鼓的 Tun 调在萨（D4）上；左手鼓的 Ge 推上去，音高往上走", () => {
    const tun = drum(REGIONAL_DRUMS.tabla_tun, SR, 1);
    const f = peakFreq(tun, 0.08, 0.3, 250, 340);
    expect(Math.abs(1200 * Math.log2(f / hz(62))), `${f} Hz`).toBeLessThan(40);
    const ge = drum(REGIONAL_DRUMS.bayan_ge, SR, 1);
    expect(pitchOf(ge, Math.floor(0.3 * SR), 4000, 50, 250)).toBeGreaterThan(pitchOf(ge, 200, 2500, 50, 250) * 1.15);
  });
});

describe("吹奏与弓弦", () => {
  const sustains = Object.entries(REGIONAL_INSTRUMENTS).filter(([, i]) => i.kind !== "pluck" && i.kind !== "mallet" && i.kind !== "perc").map(([k]) => k);
  const ratio = (k: string, n: number, f0 = 440) => sustain(k).amps(n, n * f0) / sustain(k).amps(1, f0);

  it("每件：谐波表在各音区都是有限的非负数，基频不为零；音量校准在合理范围", () => {
    expect(sustains.length).toBeGreaterThanOrEqual(20);
    for (const k of sustains) {
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

  it("排箫是闭管：奇次谐波强、偶次几乎没有；陶笛几乎是正弦", () => {
    expect(ratio("siku", 2)).toBeLessThan(0.05);
    expect(ratio("siku", 3)).toBeGreaterThan(ratio("siku", 2) * 5);
    for (let n = 2; n <= 6; n++) expect(ratio("ocarina", n), `${n}`).toBeLessThan(0.07);
  });

  it("双簧管一族（唢呐、祖尔纳、谢赫奈、筚篥、祖马里）比竹笛亮得多", () => {
    const bright = (k: string) => [6, 8, 10].reduce((s, n) => s + ratio(k, n), 0);
    for (const k of ["suona", "zurna", "shehnai", "hichiriki", "zumari"]) for (const flute of ["bansuri", "shakuhachi", "xiao", "ocarina"]) expect(bright(k), `${k} 对 ${flute}`).toBeGreaterThan(bright(flute) * 3);
  });

  it("气声：尺八、奈伊笛、排箫、箫的气声与跟着波形的噪声比陶笛多；梆笛的笛膜在五倍频上“沙”", () => {
    const air = (k: string) => (sustain(k).breath?.level ?? 0) + (sustain(k).pulse?.level ?? 0);
    for (const k of ["shakuhachi", "nay", "siku", "xiao"]) expect(air(k), k).toBeGreaterThan(air("ocarina") * 2);
    expect(sustain("bangdi").pulse!.ratio).toBeGreaterThanOrEqual(4);
    expect(sustain("bangdi").pulse!.level).toBeGreaterThan(sustain("bangdi").breath!.level * 3);
  });

  it("二胡、克曼切、雷巴布是弓弦，滑音比提琴长；尺八、班苏里、二胡的 !vib! 揉得更深", () => {
    for (const k of ["erhu", "kemence", "rebab"]) {
      expect(sustain(k).kind, k).toBe("bowed");
      expect(sustain(k).glide, k).toBeGreaterThan(0.05);
    }
    for (const k of ["shakuhachi", "bansuri", "erhu"]) expect(sustain(k).vibBoost ?? 2.2, k).toBeGreaterThan(1.5);
  });
});

describe("编织式的写法", () => {
  it("排箫的轮吹：两个声部一人一音，合起来正好是原来的旋律，每小节的长度不变", () => {
    const mel = "e2 e/2d/2c d2 e2 | g2 g/2e/2d e4";
    const a = hocket(mel, 0);
    const b = hocket(mel, 1);
    const notes = (s: string) => s.split(/\s+/).filter((t) => t && t !== "|" && !t.startsWith("z"));
    expect(notes(a)).toEqual(["e2", "d/2", "d2", "g2", "e/2", "e4"]);
    expect(notes(b)).toEqual(["e/2", "c", "e2", "g/2", "d"]);
    const t = { id: "h", title: { zh: "h", en: "h" }, qpm: 100, meter: [4, 4] as const, key: "A minor", voices: {}, sections: { A: { bars: 2, lines: { a, b } } }, forms: [[{ s: "A", play: "" }]], rest: [0, 0] as const };
    for (const l of ["a", "b"]) expect(badBars(lineOf(t, "A", l), 8)).toEqual([]);
  });

  it("甘美兰的咬合：两个声部从不同时响，合起来每个十六分音符正好一个音；锣只落在指定的拍上", () => {
    const bal = ["B", "c", "B", "G", "F", "G", "B", "c"];
    const ladder = { notes: ["E", "F", "G", "B", "c", "e", "f", "g"] };
    const { polos, sangsih } = kotekan(bal, ladder);
    const cells = (s: string) => s.split(/\s+/).filter((t) => t && t !== "|").map((t) => !t.startsWith("z"));
    const p = cells(polos);
    const q = cells(sangsih);
    expect(p.length).toBe(32);
    expect(q.length).toBe(32);
    for (let i = 0; i < 32; i++) expect(p[i] !== q[i], `第 ${i} 格`).toBe(true);
    expect(woven(bal, ladder).split(/\s+/).filter((t) => t && t !== "|").length).toBe(8);
    expect(beats(bal)).toBe("B2 c2 B2 G2 | F2 G2 B2 c2");
    expect(punctuate(bal, 4)).toBe("z6 G2 | z6 c2");
    expect(punctuate(bal, 2, ",,", [1])).toBe("z8 | z2 G,,2 z4");
  });
});
