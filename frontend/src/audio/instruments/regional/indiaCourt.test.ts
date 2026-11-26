// 地方乐器第二阶段·印度（莫卧儿宫廷与南印度、马拉巴尔、孟加拉）：十七件乐器的登记与各自的声音特征——
// 维纳琴的桥嗡与宽而慢的揉弦（kampita / andolan），鲁德拉维纳琴比西塔琴低沉、余音长，拉巴卜与多塔拉的皮面，萨朗吉的共鸣弦与长滑音，
// 纳达斯瓦拉姆比谢赫奈亮、摆得更深，奥图是持续音，水碗的“水”在拍，伊达卡有清楚的音高；
// 姆里丹加姆调在萨（E3）上、左面推音，帕卡瓦吉比塔布拉低，塔维尔、陶罐鼓、琴达、小钹的高与长，甘吉拉与陶罐鼓的推音；
// 萨 = E 的塔布拉（右手鼓调在 E4，是第一阶段 D4 那只整体移上一个全音）。
// 通用的检查（确定、没有非数、峰值、音高、音色样本的曲谱）在 regional.test.ts 里对全部地方乐器一起做。
import { describe, expect, it } from "vitest";
import { drum, mallet, pluck, type MalletSpec, type PluckSpec } from "../../dsp";
import { PLUCK_VIB } from "../../engine";
import type { Instrument, SustainSpec } from "../../instruments";
import { REGIONAL, REGIONAL_DRUMS, REGIONAL_INSTRUMENTS, regionalId } from ".";
import { TABLA } from "./tabla";
import { TABLA_E } from "./tablaE";

const SR = 44100;
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function inst(key: string): Instrument {
  const i = REGIONAL_INSTRUMENTS[key];
  if (!i) throw new Error(key);
  return i;
}
function pluckInst(key: string): Extract<Instrument, { kind: "pluck" }> {
  const i = inst(key);
  if (i.kind !== "pluck") throw new Error(key);
  return i;
}
function pluckSpec(key: string): PluckSpec {
  return pluckInst(key).spec;
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

/** 一阶滤波把信号分成 f 以下与以上，返回 f 以下的能量比例。 */
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

/** 20 毫秒窗口的均方根在 [t0, t1) 秒里的最小与最大之比（越小起伏越大）。 */
function ripple(x: Float32Array, t0: number, t1: number): number {
  const win = Math.floor(0.02 * SR);
  const rms: number[] = [];
  for (let a = Math.floor(t0 * SR); a + win < Math.min(x.length, t1 * SR); a += win) rms.push(Math.sqrt(energy(x, a, a + win)));
  return Math.min(...rms) / Math.max(...rms);
}

// 拉巴卜的键整合时改成 seni_rabab（与马格里布的 rabab 重名，见 DECISIONS“测试期望值变更”）
const PITCHED = ["rudra_veena", "seni_rabab", "sarangi", "saraswati_veena", "nadaswaram", "ottu", "jaltarang", "edakka", "dotara"];
const HITS = [
  "pakh_ta", "pakh_din", "pakh_tit", "pakh_ka", "pakh_ge", "naq_dhum", "naq_tak",
  "thavil_ta", "thavil_ki", "thavil_dhom", "talam", "talam_chik",
  "mrd_nam", "mrd_din", "mrd_chapu", "mrd_ki", "mrd_tha", "mrd_thom", "mrd_gumki",
  "kanj_bass", "kanj_ta", "kanj_ki", "ghatam_ta", "ghatam_ki", "ghatam_thom", "ghatam_gumki", "chenda_valam", "chenda_edam",
];

describe("第二阶段·印度的地方乐器：登记", () => {
  it("九件有音高的乐器与八组打击乐（二十八个鼓点）都登记在印度，有中英文名与音色样本", () => {
    for (const k of PITCHED) {
      const d = REGIONAL.find((r) => r.key === k);
      expect(d, k).toBeTruthy();
      expect(d!.region, k).toBe("india");
      expect(d!.demo.abc, k).toBeTruthy();
    }
    for (const h of HITS) {
      const d = REGIONAL.find((r) => Object.prototype.hasOwnProperty.call(r.drums ?? {}, h));
      expect(d, h).toBeTruthy();
      expect(d!.region, h).toBe("india");
      expect(d!.demo.drum?.length, h).toBeGreaterThan(0);
    }
    const ids = new Set(REGIONAL.map(regionalId));
    for (const id of ["pakh_ta", "naq_dhum", "thavil_ta", "talam", "mrd_nam", "kanj_bass", "ghatam_ta", "chenda_valam"]) expect(ids.has(id), id).toBe(true);
    // 印度现在有二十四件（第一阶段六件 + 第二阶段十七件 + 萨 = E 的塔布拉）
    expect(REGIONAL.filter((d) => d.region === "india").length).toBe(24);
  });
});

describe("第二阶段·印度的拨弦", () => {
  it("萨拉斯瓦蒂维纳琴与鲁德拉维纳琴：弧形琴桥的“嗡”让余音里的高次谐波留得更久（比不嗡时多）", () => {
    for (const [k, m, t0, t1] of [["saraswati_veena", 57, 0.7, 0.9], ["rudra_veena", 40, 1.0, 1.3]] as const) {
      const spec = pluckSpec(k);
      expect(spec.buzz, k).toBeTruthy();
      const f = hz(m);
      const withBuzz = highShare(pluck(spec, f, SR, 7), f, t0, t1);
      const without = highShare(pluck({ ...spec, buzz: undefined }, f, SR, 7), f, t0, t1);
      expect(withBuzz, `${k}：${withBuzz.toFixed(3)} 对 ${without.toFixed(3)}`).toBeGreaterThan(without * 1.3);
    }
  });

  it("维纳琴的“嗡”比西塔琴轻：同一个音、同一个时刻，高次谐波的比例比西塔琴少", () => {
    const f = hz(57);
    const veena = highShare(pluck(pluckSpec("saraswati_veena"), f, SR, 3), f, 0.7, 0.9);
    const sitar = highShare(pluck(pluckSpec("sitar"), f, SR, 3), f, 0.7, 0.9);
    expect(veena, `${veena.toFixed(3)} 对 ${sitar.toFixed(3)}`).toBeLessThan(sitar);
  });

  it("维纳琴的 kampita 与鲁德拉维纳琴的 andolan：!vib! 比缺省的揉弦宽而慢，鲁德拉维纳琴最慢", () => {
    const v = pluckInst("saraswati_veena").pluckVib!;
    const r = pluckInst("rudra_veena").pluckVib!;
    for (const x of [v, r]) {
      expect(x.depth).toBeGreaterThan(PLUCK_VIB.depth * 1.8);
      expect(x.rate).toBeLessThan(PLUCK_VIB.rate);
    }
    expect(r.rate).toBeLessThan(v.rate);
    // 约 ±50 音分：比半音的一半大，比全音小
    expect(1200 * Math.log2(1 + v.depth)).toBeGreaterThan(40);
    expect(1200 * Math.log2(1 + v.depth)).toBeLessThan(100);
  });

  it("鲁德拉维纳琴比西塔琴低沉（500 Hz 以下的能量多）、余音长；拉巴卜的余音最短", () => {
    const f = hz(48);
    const rudra = pluck(pluckSpec("rudra_veena"), f, SR, 2);
    const sitar = pluck(pluckSpec("sitar"), f, SR, 2);
    const rabab = pluck(pluckSpec("seni_rabab"), f, SR, 2);
    expect(lowShare(rudra, 500)).toBeGreaterThan(lowShare(sitar, 500));
    expect(rudra.length).toBeGreaterThan(sitar.length * 1.3);
    expect(rabab.length).toBeLessThan(sitar.length);
  });

  it("多塔拉：拨片打在羊皮的琴面上（260 Hz 一带的“嘭”），金属弦比拉巴卜的羊肠弦亮", () => {
    const spec = pluckSpec("dotara");
    const f = hz(64);
    expect(power(pluck(spec, f, SR, 2), 260, 0, 0.06)).toBeGreaterThan(power(pluck({ ...spec, skin: undefined }, f, SR, 2), 260, 0, 0.06) * 1.4);
    const bright = highShare(pluck(spec, f, SR, 4), f, 0.05, 0.25);
    const dark = highShare(pluck(pluckSpec("seni_rabab"), f, SR, 4), f, 0.05, 0.25);
    expect(bright, `${bright.toFixed(3)} 对 ${dark.toFixed(3)}`).toBeGreaterThan(dark * 1.5);
  });

  it("拉巴卜：木拨子打在蒙皮的琴面上，180 Hz 一带的“嘭”只在起音的几十毫秒里", () => {
    const spec = pluckSpec("seni_rabab");
    expect(spec.skin).toBeTruthy();
    const f = hz(60);
    expect(power(pluck(spec, f, SR, 2), 180, 0, 0.06)).toBeGreaterThan(power(pluck({ ...spec, skin: undefined }, f, SR, 2), 180, 0, 0.06) * 1.4);
  });
});

describe("第二阶段·印度的弓弦与吹奏", () => {
  const ratio = (k: string, n: number, f0 = 440) => sustain(k).amps(n, n * f0) / sustain(k).amps(1, f0);
  const bright = (k: string) => [6, 8, 10].reduce((s, n) => s + ratio(k, n), 0);

  it("萨朗吉：弓弦、滑音比二胡长、揉得深；共鸣弦是一排半音阶（十几根，C4–D5 每个半音都有），带通很窄", () => {
    const s = sustain("sarangi");
    expect(s.kind).toBe("bowed");
    expect(s.glide).toBeGreaterThan(sustain("erhu").glide);
    expect(s.vibBoost ?? 2.2).toBeGreaterThanOrEqual(2.5);
    const sym = s.sympathetic!;
    expect(sym.notes.length).toBeGreaterThanOrEqual(12);
    for (let m = 60; m <= 74; m++) expect(sym.notes, `${m}`).toContain(m);
    // 带通的余音约 2.2·q/f 秒：中音区的弦响半秒以上
    expect((2.2 * sym.q) / hz(74)).toBeGreaterThan(0.5);
    expect(sym.level).toBeGreaterThan(0);
    expect(sym.level).toBeLessThan(1);
  });

  it("萨朗吉的音色像人声：1.1 kHz 的第二共振峰比旁边高", () => {
    const amps = sustain("sarangi").amps;
    const f0 = 220;
    // 第五谐波（1100 Hz）比第七谐波（1540 Hz）响
    expect(amps(5, 5 * f0)).toBeGreaterThan(amps(7, 7 * f0));
  });

  it("纳达斯瓦拉姆是双簧管一族：比班苏里亮得多，也比谢赫奈亮；kampita（!vib!）比谢赫奈摆得深，滑音更长", () => {
    expect(bright("nadaswaram")).toBeGreaterThan(bright("bansuri") * 3);
    expect(bright("nadaswaram")).toBeGreaterThan(bright("shehnai"));
    const n = sustain("nadaswaram");
    const s = sustain("shehnai");
    expect(n.vib!.depth * (n.vibBoost ?? 2.2)).toBeGreaterThan(s.vib!.depth * (s.vibBoost ?? 2.2) * 1.4);
    expect(n.glide).toBeGreaterThan(s.glide);
  });

  it("奥图是持续音（长音乐器，慢起慢收、两片簧有一点音差）", () => {
    const o = sustain("ottu");
    expect(o.kind).toBe("pad");
    expect(o.attack).toBeGreaterThan(0.3);
    expect(o.detune ?? 0).toBeGreaterThan(0);
  });
});

describe("第二阶段·印度的击奏", () => {
  it("水碗：同一个音分成两个分音，包络“水”一样地起伏；余音比伊达卡长", () => {
    const spec = malletSpec("jaltarang");
    expect(spec.beat ?? 0).toBeGreaterThan(1);
    const x = mallet(spec, hz(76), SR, 3);
    expect(ripple(x, 0.15, 1.2)).toBeLessThan(0.5);
    const e = mallet(malletSpec("edakka"), hz(64), SR, 3);
    expect(x.length).toBeGreaterThan(e.length);
  });

  it("伊达卡：敲一下就有清楚的音高（基频准），很快消失", () => {
    const f = hz(64);
    const x = mallet(malletSpec("edakka"), f, SR, 5);
    const p = pitchOf(x, 2000, 3000, f * 0.6, f * 1.6);
    expect(Math.abs(1200 * Math.log2(p / f))).toBeLessThan(25);
    expect(x.length / SR).toBeLessThan(1.3);
  });
});

describe("第二阶段·印度的鼓点", () => {
  const hit = (h: string, seed = 1) => drum(REGIONAL_DRUMS[h], SR, seed);

  it("姆里丹加姆：右面的 Din 调在萨（E3）上；Chapu 是高处的“叮”（最响的是四倍音以上，比 Din 高两个八度）；左面 Thom 低沉，Gumki 推上去", () => {
    const din = hit("mrd_din");
    const f = peakFreq(din, 0.08, 0.4, 130, 200);
    expect(Math.abs(1200 * Math.log2(f / hz(52))), `${f} Hz`).toBeLessThan(40);
    const chapu = peakFreq(hit("mrd_chapu"), 0.05, 0.4, 100, 1500, 2);
    expect(chapu, `${chapu} Hz`).toBeGreaterThan(hz(52) * 3.8);
    expect(lowShare(hit("mrd_thom"), 250)).toBeGreaterThan(0.7);
    const g = hit("mrd_gumki");
    expect(pitchOf(g, Math.floor(0.3 * SR), 4000, 50, 250)).toBeGreaterThan(pitchOf(g, 200, 2500, 50, 250) * 1.15);
  });

  it("帕卡瓦吉比塔布拉低：右面的 Din 调在萨（C3）上，比塔布拉的 Tun 低一个八度以上；左面的 Ge 低沉", () => {
    const din = hit("pakh_din");
    const f = peakFreq(din, 0.08, 0.4, 110, 160);
    expect(Math.abs(1200 * Math.log2(f / hz(48))), `${f} Hz`).toBeLessThan(40);
    const tun = peakFreq(hit("tabla_tun"), 0.08, 0.3, 250, 340);
    expect(f).toBeLessThan(tun / 1.9);
    expect(lowShare(hit("pakh_ge"), 250)).toBeGreaterThan(0.8);
  });

  it("甘吉拉与陶罐鼓的推音：低音一边响一边往上走", () => {
    for (const h of ["kanj_bass", "ghatam_gumki"]) {
      const x = hit(h);
      expect(pitchOf(x, Math.floor(0.25 * SR), 3000, 60, 400), h).toBeGreaterThan(pitchOf(x, 200, 2000, 60, 400) * 1.15);
    }
  });

  it("塔维尔的 Ta、琴达的右面、小钹在高处；塔维尔的 Dhom、纳卡拉的大鼓、琴达的左面、陶罐鼓的 Thom 在低处", () => {
    for (const h of ["thavil_ta", "chenda_valam", "talam", "talam_chik"]) expect(lowShare(hit(h), 500), h).toBeLessThan(0.3);
    for (const h of ["thavil_dhom", "naq_dhum", "chenda_edam", "ghatam_thom"]) expect(lowShare(hit(h), 250), h).toBeGreaterThan(0.7);
  });

  it("纳卡拉：小锅鼓（Tak）比大锅鼓（Dhum）高约两个八度，大鼓的余音长得多", () => {
    const tak = hit("naq_tak");
    const dhum = hit("naq_dhum");
    const fTak = peakFreq(tak, 0.01, 0.15, 150, 1000, 2);
    const fDhum = peakFreq(dhum, 0.05, 0.4, 50, 300, 1);
    expect(fTak, `${fTak} 对 ${fDhum} Hz`).toBeGreaterThan(fDhum * 3.5);
    expect(dhum.length).toBeGreaterThan(tak.length * 2);
  });

  it("陶罐鼓：指尖敲罐颈的 Ta 是 500 Hz 一带的陶罐共鸣加上很短的脆响，比手掌拍罐腹的 Thom 高两个八度以上、短得多", () => {
    const ta = hit("ghatam_ta");
    const thom = hit("ghatam_thom");
    const fTa = peakFreq(ta, 0, 0.08, 100, 1500, 2);
    const fThom = peakFreq(thom, 0.02, 0.2, 60, 400, 1);
    expect(fTa, `${fTa} Hz`).toBeGreaterThan(400);
    expect(fTa).toBeGreaterThan(fThom * 3.5);
    expect(ta.length).toBeLessThan(thom.length * 0.5);
  });

  it("小钹：开的“叮”余音一秒以上、最响的分音在 1.5 kHz 以上；闷的“嚓”很短", () => {
    const open = hit("talam");
    expect(open.length / SR).toBeGreaterThan(1);
    const f = peakFreq(open, 0.05, 0.5, 200, 6000, 10);
    expect(f, `${f} Hz`).toBeGreaterThan(1500);
    expect(hit("talam_chik").length / SR).toBeLessThan(0.3);
  });

  it("萨 = E 的塔布拉：右手鼓的 Tun 调在 E4，第一阶段那只在 D4（高一个全音）；Na 的二倍音“叮”也跟着高一个全音；左手鼓共用第一阶段的", () => {
    const tunE = peakFreq(hit("tabla_e_tun"), 0.08, 0.3, 250, 400);
    const tunD = peakFreq(hit("tabla_tun"), 0.08, 0.3, 250, 400);
    expect(Math.abs(1200 * Math.log2(tunE / hz(64))), `${tunE} Hz`).toBeLessThan(30);
    expect(Math.abs(1200 * Math.log2(tunD / hz(62))), `${tunD} Hz`).toBeLessThan(30);
    const naE = peakFreq(hit("tabla_e_na"), 0.02, 0.3, 500, 800);
    const naD = peakFreq(hit("tabla_na"), 0.02, 0.3, 500, 800);
    expect(Math.abs(1200 * Math.log2(naE / naD) - 200), `${naE} / ${naD} Hz`).toBeLessThan(30);
    expect(Object.keys(TABLA_E.drums ?? {}).some((h) => h.startsWith("bayan")), "左手鼓不另做").toBe(false);
    expect(TABLA_E.demo.drum?.some((d) => Object.values(d.hits).some(([h]) => h === "bayan_ge"))).toBe(true);
  });

  it("萨 = E 的塔布拉是第一阶段那只整体移调：鼓皮层的频率逐层乘 2^(2/12)，泛音比、衰减、音量、噪声层与随机偏差逐个相同", () => {
    const ratio = Math.pow(2, 2 / 12);
    for (const name of ["na", "tin", "tun", "te"]) {
      const d = TABLA.drums![`tabla_${name}`];
      const e = TABLA_E.drums![`tabla_e_${name}`];
      expect(e.vary, name).toBe(d.vary);
      expect(e.layers.length, name).toBe(d.layers.length);
      e.layers.forEach((l, i) => {
        const o = d.layers[i];
        if (l.kind === "skin" && o.kind === "skin") {
          expect(l.f0 / o.f0, `${name} 第 ${i} 层`).toBeCloseTo(ratio, 12);
          expect(l.f1 / o.f1, `${name} 第 ${i} 层`).toBeCloseTo(ratio, 12);
          expect({ ...l, f0: 0, f1: 0 }, `${name} 第 ${i} 层`).toEqual({ ...o, f0: 0, f1: 0 });
        } else expect(l, `${name} 第 ${i} 层`).toEqual(o);
      });
    }
  });
});
