// 地方乐器第二阶段·阿拉伯、波斯、马格里布：登记，以及每件乐器合成出来的声音的大致特征（频谱的“签名”）——
// 里克鼓的黄铜小钹比铃鼓亮、余音长；米兹玛尔是双簧管但比祖尔纳暗；塔布勒大鼓比达布卡低；拍手在中高频、空心掌更低；
// 红海的西姆西米亚琴比乌德琴亮、余音比波斯桑图尔短、没按住的空弦跟着响；海湾的陶罐“嗡”在 110 Hz 一带、米尔瓦斯的“咚”高而短；
// 波斯桑图尔的余音比印度桑图尔与卡农琴长；塔尔琴的皮面比乌德琴亮、赛塔尔琴比塔尔琴暗而软；卡曼恰比克曼切暗；
// 东巴克鼓的“通”比达布卡低、“巴克”没有金属的余响；达夫的“咚”很低、铁环的“哗”拖得长；拉巴卜最暗、弓噪最重；
// 金布里琴的低音准、骆驼皮的一声闷响、铁片的沙沙声；卡拉卡布在高频、合上的“嚓”比张开的“咔”短。
// 另有木卡姆与达斯特加的调式（拉斯特、查哈尔加的四分之一音）。
import { describe, expect, it } from "vitest";
import { drum, peak, pluck, type PluckSpec } from "../../dsp";
import { CORE_DRUMS, CORE_INSTRUMENTS, DRUMS, INSTRUMENTS, type Instrument, type SustainSpec } from "../../instruments";
import { MODES, parseKey } from "../../theory";
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
function sustain(key: string): SustainSpec {
  const i = INSTRUMENTS[key];
  if (!i || i.kind === "pluck" || i.kind === "mallet" || i.kind === "perc") throw new Error(key);
  return i;
}
function hit(name: string, seed = 1): Float32Array {
  const spec = DRUMS[name];
  if (!spec) throw new Error(name);
  return drum(spec, SR, seed);
}

/** [a, b) 秒里的平均功率。 */
function energy(x: Float32Array, a: number, b: number): number {
  const i = Math.floor(a * SR);
  const j = Math.min(x.length, Math.floor(b * SR));
  let e = 0;
  for (let n = i; n < j; n++) e += x[n] * x[n];
  return e / Math.max(1, j - i);
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

/** f 以下的能量比例（一阶低通分频）。 */
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

/** f 以上的部分（一阶高通）。 */
function highPassed(x: Float32Array, f: number): Float32Array {
  const a = 1 - Math.exp((-2 * Math.PI * f) / SR);
  const y = new Float32Array(x.length);
  let lp = 0;
  for (let n = 0; n < x.length; n++) {
    lp += a * (x[n] - lp);
    y[n] = x[n] - lp;
  }
  return y;
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

/** 谐波表的亮度：第 6–10 次谐波相对基频的振幅之和（f0 = 440 Hz）。 */
function bright(key: string, f0 = 440): number {
  const s = sustain(key);
  let sum = 0;
  for (let n = 6; n <= 10; n++) sum += s.amps(n, n * f0) / s.amps(1, f0);
  return sum;
}

const KEYS = ["mizmar", "simsimiyya", "santur", "tar", "setar", "kamancheh", "rabab", "gimbri"];
const HITS = ["riq_dum", "riq_tak", "riq_ka", "riq_sak", "tabl_dum", "tabl_tak", "tasfiq", "tasfiq_low", "mirwas_dum", "mirwas_tak", "jahlah", "jahlah_tak", "tombak_tom", "tombak_bak", "tombak_pelang", "tombak_riz", "daf_dum", "daf_tak", "daf_ring", "gimbri_slap", "qraqeb", "qraqeb_shut"];

describe("第二阶段的登记：阿拉伯、波斯、马格里布", () => {
  it("十六件都登记了：地区对，有键的进了乐器表，鼓点进了鼓点表；不与原有的乐器、鼓点重名", () => {
    const mine = REGIONAL.filter((d) => d.region === "arabia" || d.region === "persia" || d.region === "maghreb");
    expect(mine.length).toBe(16);
    expect(mine.filter((d) => d.region === "arabia").map(regionalId)).toEqual(["riq_dum", "mizmar", "tabl_dum", "tasfiq", "simsimiyya", "mirwas_dum", "jahlah"]);
    expect(mine.filter((d) => d.region === "persia").map(regionalId)).toEqual(["santur", "tar", "setar", "kamancheh", "tombak_tom", "daf_dum"]);
    expect(mine.filter((d) => d.region === "maghreb").map(regionalId)).toEqual(["rabab", "gimbri", "qraqeb"]);
    for (const k of KEYS) {
      expect(REGIONAL_INSTRUMENTS[k], k).toBeTruthy();
      expect(Object.prototype.hasOwnProperty.call(CORE_INSTRUMENTS, k), k).toBe(false);
    }
    for (const h of HITS) {
      expect(REGIONAL_DRUMS[h], h).toBeTruthy();
      expect(Object.prototype.hasOwnProperty.call(CORE_DRUMS, h), h).toBe(false);
    }
  });

  it("新的一件不顶替旧的：波斯的卡曼恰与奥斯曼的克曼切、安达卢斯的拉巴卜与爪哇的雷巴布、波斯与印度的桑图尔、里克鼓与原有的铃鼓，各是各的", () => {
    expect(INSTRUMENTS.kamancheh).not.toBe(INSTRUMENTS.kemence);
    expect(INSTRUMENTS.rabab).not.toBe(INSTRUMENTS.rebab);
    expect(INSTRUMENTS.santur).not.toBe(INSTRUMENTS.santoor);
    expect(DRUMS.riq).toBe(CORE_DRUMS.riq);
    expect(DRUMS.riq_tak).not.toBe(DRUMS.riq);
  });

  for (const h of HITS) {
    it(`${h}：确定、没有非数、峰值归一、不超过 3 秒`, () => {
      const x = hit(h, 9);
      expect(x.every(Number.isFinite)).toBe(true);
      expect(peak(x)).toBeCloseTo(0.8, 1);
      expect(x.length / SR).toBeLessThan(3.1);
      const y = hit(h, 9);
      expect(y.length).toBe(x.length);
      for (let i = 0; i < x.length; i += 97) expect(y[i]).toBe(x[i]);
    });
  }
});

describe("木卡姆与达斯特加的调式", () => {
  it("拉斯特：三级与七级降四分之一音（中立音程）；查哈尔加：二级与六级是 koron", () => {
    const rast = parseKey("C rast");
    expect(rast.scale).toEqual([0, 2, 3.5, 5, 7, 9, 10.5]);
    expect(rast.signature.E).toBe(-0.5);
    expect(rast.signature.B).toBe(-0.5);
    expect(rast.signature.D).toBe(0);
    const ch = parseKey("C chahargah");
    expect(ch.scale).toEqual([0, 1.5, 4, 5, 7, 8.5, 11]);
    expect(ch.signature.D).toBe(-0.5);
    expect(ch.signature.A).toBe(-0.5);
    expect(ch.signature.B).toBe(0);
    // 二、三级之间与六、七级之间的大跨度（约 250 音分）
    expect(ch.scale[2] - ch.scale[1]).toBe(2.5);
    expect(ch.scale[6] - ch.scale[5]).toBe(2.5);
  });

  it("原有的调式一个没变", () => {
    expect(MODES.bayati).toEqual([0, 1.5, 3, 5, 7, 8, 10]);
    expect(MODES.hijaz).toEqual([0, 1, 4, 5, 7, 8, 10]);
    expect(MODES.ionian).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(parseKey("D bayati").signature.E).toBe(-0.5);
    expect(parseKey("A hijaz").signature.C).toBe(1);
  });
});

describe("阿拉伯", () => {
  it("里克鼓：鼓边的“嗒”几乎全是高频的铜钹；鼓心的“咚”带着皮的低音；整面一摇的“沙”比原有的铃鼓（riq）余音长", () => {
    const tak = hit("riq_tak");
    const dum = hit("riq_dum");
    expect(lowShare(tak, 2500)).toBeLessThan(0.3);
    expect(lowShare(dum, 400)).toBeGreaterThan(lowShare(tak, 400) * 3);
    const tail = (x: Float32Array) => energy(x, 0.1, 0.25) / energy(x, 0, 0.05);
    expect(tail(hit("riq_sak"))).toBeGreaterThan(tail(hit("riq")) * 2);
  });

  it("里克鼓的黄铜小钹有音高（几支不谐和的分音）：3–4.5 kHz 一带有明显的峰，噪声做不出这种峰", () => {
    const x = hit("riq_tak", 3);
    const f = peakFreq(x, 0.02, 0.15, 2600, 4600, 10);
    const onPeak = power(x, f, 0.02, 0.15);
    const offPeak = (power(x, f * 0.9, 0.02, 0.15) + power(x, f * 1.1, 0.02, 0.15)) / 2;
    expect(onPeak).toBeGreaterThan(offPeak * 4);
  });

  it("米兹玛尔：双簧管，比奈伊笛、尺八亮得多；共振峰更低，4 kHz 以上比祖尔纳暗（鼻音更重）", () => {
    expect(sustain("mizmar").kind).toBe("wind");
    for (const flute of ["nay", "shakuhachi"]) expect(bright("mizmar")).toBeGreaterThan(bright(flute) * 3);
    const above = (key: string, f0 = 440) => {
      const s = sustain(key);
      let hi = 0,
        all = 0;
      for (let n = 1; n <= 24; n++) {
        const a = s.amps(n, n * f0);
        all += a * a;
        if (n * f0 > 4000) hi += a * a;
      }
      return hi / all;
    };
    expect(above("mizmar")).toBeLessThan(above("zurna"));
  });

  it("塔布勒大鼓：“咚”的能量都在低频，音高比达布卡的“咚”低；藤条的“嗒”在高处", () => {
    const dum = hit("tabl_dum");
    expect(lowShare(dum, 250)).toBeGreaterThan(0.8);
    expect(peakFreq(dum, 0.08, 0.4, 40, 160)).toBeLessThan(peakFreq(hit("darb_doum"), 0.08, 0.4, 40, 160));
    expect(lowShare(hit("tabl_tak"), 1000)).toBeLessThan(0.3);
  });

  it("西姆西米亚琴：金属弦、拨片刮过被按住的弦——比乌德琴亮（高次谐波多）、拨片的“嚓”更重；皮面的碗让余音比波斯的桑图尔短；音高准", () => {
    const f = hz(62);
    const share = (k: string) => highShare(pluck(pluckSpec(k), f, SR, 2), f, 0.05, 0.25);
    expect(share("simsimiyya")).toBeGreaterThan(share("ud") * 1.3);
    expect(pluckSpec("simsimiyya").thump!).toBeGreaterThan(pluckSpec("ud").thump! * 2);
    const sustainOf = (k: string) => {
      const x = pluck(pluckSpec(k), hz(67), SR, 4);
      return energy(x, 0.8, 1.4) / energy(x, 0, 0.1);
    };
    expect(sustainOf("simsimiyya")).toBeLessThan(sustainOf("santur") * 0.5);
    const x = pluck(pluckSpec("simsimiyya"), f, SR, 7);
    expect(x.every(Number.isFinite)).toBe(true);
    const p = pitchOf(x, 4000, 4000, f * 0.7, f * 1.4);
    expect(Math.abs(1200 * Math.log2(p / f)), `${p.toFixed(1)} Hz`).toBeLessThan(20);
  });

  it("西姆西米亚琴：没按住的空弦（G4）被拨片带着响——拨一个不在定弦上的音（E4）时，392 Hz 一带比不带空弦时多", () => {
    const spec = pluckSpec("simsimiyya");
    expect(spec.sympathetic).toBeTruthy();
    const f = hz(64);
    const at = (s: PluckSpec) => power(pluck(s, f, SR, 3), hz(67), 0.1, 0.6);
    expect(at(spec)).toBeGreaterThan(at({ ...spec, sympathetic: undefined }) * 3);
  });

  it("贾赫拉陶罐：掌拍罐口的“嗡”是 95–130 Hz 的一声、能量都在低频，2 kHz 以上几乎没有（闷）；手指敲罐肚的“嗒”在高处、很短", () => {
    const j = hit("jahlah");
    expect(lowShare(j, 250)).toBeGreaterThan(0.75);
    const f = peakFreq(j, 0.02, 0.2, 60, 200);
    expect(f).toBeGreaterThan(95);
    expect(f).toBeLessThan(130);
    // 2 kHz 以上的能量不到千分之一（闷）
    expect(energy(highPassed(highPassed(j, 2000), 2000), 0, 0.3) / energy(j, 0, 0.3)).toBeLessThan(0.001);
    const t = hit("jahlah_tak");
    expect(peakFreq(t, 0.001, 0.04, 200, 2000, 5)).toBeGreaterThan(700);
    expect(lowShare(t, 300)).toBeLessThan(0.15);
    expect(t.length).toBeLessThan(j.length);
  });

  it("米尔瓦斯：“咚”的音高在 260–340 Hz，比达布卡、东巴克的“咚”高得多，也更短；“嗒”在高处", () => {
    const d = hit("mirwas_dum");
    const f = peakFreq(d, 0.01, 0.12, 150, 500);
    expect(f).toBeGreaterThan(260);
    expect(f).toBeLessThan(340);
    for (const other of ["darb_doum", "tombak_tom"]) {
      expect(f).toBeGreaterThan(peakFreq(hit(other), 0.03, 0.3, 40, 500) * 2);
      expect(d.length).toBeLessThan(hit(other).length);
    }
    expect(lowShare(hit("mirwas_tak"), 1000)).toBeLessThan(0.3);
  });

  it("拍手：没有低频的“咚”；空心掌比平掌低", () => {
    const flat = hit("tasfiq");
    const cupped = hit("tasfiq_low");
    expect(lowShare(flat, 300)).toBeLessThan(0.1);
    expect(lowShare(cupped, 1500)).toBeGreaterThan(lowShare(flat, 1500) * 1.3);
  });
});

describe("波斯", () => {
  it("桑图尔：光木槌的长余音——1–1.6 秒处剩下的比印度的桑图尔与卡农琴多；长音是轮奏", () => {
    const sustainOf = (k: string) => {
      const x = pluck(pluckSpec(k), hz(67), SR, 4);
      return energy(x, 1.0, 1.6) / energy(x, 0, 0.1);
    };
    expect(sustainOf("santur")).toBeGreaterThan(sustainOf("santoor"));
    expect(sustainOf("santur")).toBeGreaterThan(sustainOf("kanun"));
    const s = inst("santur");
    expect(s.kind === "pluck" && s.tremolo !== undefined && (s.tremRate ?? 0) > 10).toBe(true);
    // 四根一组的弦：两根之间的音差比印度的桑图尔大（余音里的拍更明显）
    expect(pluckSpec("santur").course!).toBeGreaterThan(pluckSpec("santoor").course!);
  });

  it("塔尔琴：皮面让它比乌德琴亮（高次谐波多）；赛塔尔琴比塔尔琴暗、起音软", () => {
    const f = hz(57);
    const share = (k: string) => highShare(pluck(pluckSpec(k), f, SR, 2), f, 0.05, 0.25);
    expect(pluckSpec("tar").skin).toBeTruthy();
    expect(share("tar")).toBeGreaterThan(share("ud") * 1.2);
    expect(share("setar")).toBeLessThan(share("tar"));
    expect(pluckSpec("setar").thump!).toBeLessThan(pluckSpec("tar").thump!);
    expect(pluckSpec("setar").t60).toBeGreaterThan(pluckSpec("tar").t60);
  });

  it("卡曼恰：弓弦，比奥斯曼的克曼切暗（第 6–10 次谐波少），滑音长、深揉", () => {
    const k = sustain("kamancheh");
    expect(k.kind).toBe("bowed");
    expect(bright("kamancheh")).toBeLessThan(bright("kemence") * 0.8);
    expect(k.glide).toBeGreaterThan(0.05);
    expect(k.vibBoost ?? 2.2).toBeGreaterThan(1.5);
  });

  it("东巴克鼓：“通”比达布卡的“咚”低、能量都在低频；“巴克”干，没有达布卡“嗒”那样的金属余响", () => {
    const tom = hit("tombak_tom");
    expect(lowShare(tom, 250)).toBeGreaterThan(0.8);
    expect(peakFreq(tom, 0.08, 0.4, 40, 200)).toBeLessThan(peakFreq(hit("darb_doum"), 0.08, 0.4, 40, 200));
    const ring = (x: Float32Array) => energy(x, 0.06, 0.2) / energy(x, 0, 0.03);
    expect(ring(hit("tombak_bak"))).toBeLessThan(ring(hit("darb_tek")));
    // 响指与滚指都在高处
    expect(lowShare(hit("tombak_pelang"), 1000)).toBeLessThan(0.25);
  });

  it("达夫：“咚”的基频在 70 Hz 以下；铁环的“哗”拖得比本迪尔的羊肠响弦长", () => {
    const dum = hit("daf_dum");
    expect(peakFreq(dum, 0.05, 0.3, 40, 150)).toBeLessThan(70);
    const jingleTail = (x: Float32Array) => {
      const h = highPassed(x, 2000);
      return energy(h, 0.15, 0.35) / energy(h, 0, 0.35);
    };
    expect(jingleTail(dum)).toBeGreaterThan(jingleTail(hit("bendir")));
    expect(lowShare(hit("daf_ring"), 1500)).toBeLessThan(0.1);
  });
});

describe("马格里布", () => {
  it("拉巴卜：弓弦，比克曼切、卡曼恰都暗，弓毛的噪声（跟着波形的与平的）比克曼切重", () => {
    const r = sustain("rabab");
    expect(r.kind).toBe("bowed");
    expect(bright("rabab")).toBeLessThan(bright("kamancheh"));
    expect(bright("rabab")).toBeLessThan(bright("kemence"));
    const noise = (k: string) => (sustain(k).pulse?.level ?? 0) + (sustain(k).breath?.level ?? 0);
    expect(noise("rabab")).toBeGreaterThan(noise("kemence") * 1.5);
  });

  it("金布里琴：低音（D2）准；拍在骆驼皮上的一声在 96 Hz 附近；琴头的铁片让 2.5 kHz 以上多出一层沙沙声", () => {
    const spec = pluckSpec("gimbri");
    const f = hz(38);
    const x = pluck(spec, f, SR, 5);
    expect(x.every(Number.isFinite)).toBe(true);
    const p = pitchOf(x, 3000, 6000, f * 0.6, f * 1.6);
    expect(Math.abs(1200 * Math.log2(p / f)), `${p.toFixed(1)} Hz`).toBeLessThan(25);
    expect(power(x, 96, 0, 0.06)).toBeGreaterThan(power(pluck({ ...spec, skin: undefined }, f, SR, 5), 96, 0, 0.06) * 1.3);
    // 3 kHz 以上（两次一阶高通）占前 0.3 秒、0.3–0.8 秒能量的比例：铁片在起音与余音里都多出一层
    const g = hz(45);
    const hiShare = (s: PluckSpec, a: number, b: number) => {
      const y = pluck(s, g, SR, 6);
      return energy(highPassed(highPassed(y, 3000), 3000), a, b) / energy(y, a, b);
    };
    expect(hiShare(spec, 0, 0.3)).toBeGreaterThan(hiShare({ ...spec, rattle: undefined }, 0, 0.3) * 1.3);
    expect(hiShare(spec, 0.3, 0.8)).toBeGreaterThan(hiShare({ ...spec, rattle: undefined }, 0.3, 0.8) * 1.2);
  });

  it("沙沙的附件只在写了 rattle 时才有：同一根弦不写它时与原来的做法逐采样相同（原有的拨弦乐器不受影响）", () => {
    const spec = pluckSpec("ud");
    expect(spec.rattle).toBeUndefined();
    const a = pluck(spec, hz(57), SR, 3);
    const b = pluck({ ...spec, rattle: undefined }, hz(57), SR, 3);
    expect(b.length).toBe(a.length);
    for (let i = 0; i < a.length; i += 61) expect(b[i]).toBe(a[i]);
    for (const [k, i] of Object.entries(INSTRUMENTS)) if (i.kind === "pluck" && k !== "gimbri") expect(i.spec.rattle, k).toBeUndefined();
  });

  it("卡拉卡布：张开的“咔”与合上的“嚓”都在高频；“嚓”比“咔”短", () => {
    const open = hit("qraqeb");
    const shut = hit("qraqeb_shut");
    expect(lowShare(open, 1000)).toBeLessThan(0.15);
    expect(lowShare(shut, 1000)).toBeLessThan(0.15);
    expect(shut.length).toBeLessThan(open.length);
  });
});
