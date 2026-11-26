// 地方乐器第二阶段·非洲（埃塞俄比亚高原、刚果与安哥拉、几内亚海岸）：登记，以及合成出来的声音的特征——
// 葫芦膜的“嗞嗞”让木琴的高频多出好几倍、而且比乐音先消失（音高不变）；贝格纳琴的皮片让余音里的高次谐波一直亮着；
// 科拉琴的牛皮“噗”、恩桑比弓琴比科拉琴暗；利肯贝的铁环与嗡；说话鼓敲下去先停在原来的音高、再往上滑或往下落；
// 鼓心的低音在低频、拍音与沙铃叉铃在高处；铁铃有自己的音高；马森果的弓噪比二胡、克曼切重，瓦辛特笛是气多的笛子，姆蓬吉是铜管一类。
// 每件乐器的确定性、没有非数、峰值、音高准确、音色样本的曲谱，由 regional.test.ts 对全部地方乐器逐件检查。
import { describe, expect, it } from "vitest";
import { drum, mallet, pluck, type MalletSpec, type PluckSpec } from "../../dsp";
import type { Instrument, SustainSpec } from "../../instruments";
import { REGIONAL, REGIONAL_DRUMS, REGIONAL_INSTRUMENTS, regionalId } from ".";
import { skin } from "./shape";

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
function peakFreq(x: Float32Array, t0: number, t1: number, lo: number, hi: number, step = 2): number {
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

/** f 以下的能量比例（一阶低通分频；a、b 为采样范围）。 */
function lowShare(x: Float32Array, f: number, a = 0, b = x.length): number {
  const c = 1 - Math.exp((-2 * Math.PI * f) / SR);
  let lp = 0,
    eLow = 0,
    eAll = 0;
  for (let n = a; n < Math.min(b, x.length); n++) {
    lp += c * (x[n] - lp);
    eLow += lp * lp;
    eAll += x[n] * x[n];
  }
  return eLow / eAll;
}

describe("非洲的地方乐器：登记", () => {
  const want: Record<string, { keys: string[]; hits: string[] }> = {
    ethiopia: { keys: ["krar", "masenqo", "begena", "washint"], hits: ["kebero_dum", "kebero_ta", "kebero_slap", "chebchebba", "chebchebba_soft", "tsenatsil", "tsenatsil_soft"] },
    kongo: {
      keys: ["madimba", "likembe", "nsambi", "mpungi"],
      hits: ["ngoma_kongo", "ngoma_kongo_tone", "ngoma_kongo_slap", "ngongi_hi", "ngongi_lo", "nkonko_hi", "nkonko_lo", "nsakala", "nsakala_soft"],
    },
    guinea: {
      keys: ["kora", "ngoni", "balafon", "tambin"],
      hits: [
        "djembe_bass",
        "djembe_tone",
        "djembe_slap",
        "dundun_ba",
        "dundun_ba_m",
        "dundun_sang",
        "dundun_ken",
        "dundun_bell",
        "gangan_hi",
        "gangan_lo",
        "gangan_up",
        "gangan_down",
        "gangan_mid",
        "shekere",
        "shekere_soft",
        "shekere_bass",
      ],
    },
  };

  for (const [region, { keys, hits }] of Object.entries(want)) {
    it(`${region}：乐器与鼓点都登记了、都属于这个地区，至少七件`, () => {
      const defs = REGIONAL.filter((d) => d.region === region);
      expect(defs.length).toBeGreaterThanOrEqual(7);
      for (const k of keys) expect(defs.map((d) => d.key), k).toContain(k);
      const own = defs.flatMap((d) => Object.keys(d.drums ?? {}));
      for (const h of hits) {
        expect(own, h).toContain(h);
        expect(REGIONAL_DRUMS[h], h).toBeTruthy();
      }
      for (const d of defs) expect(d.name.zh.length * d.name.en.length, regionalId(d)).toBeGreaterThan(0);
    });
  }
});

describe("非洲的地方乐器：拨弦", () => {
  it("贝格纳琴：皮片的嗡让余音里的高次谐波一直亮着（带与不带对照），音低、余音长", () => {
    const spec = pluckSpec("begena");
    for (const [m, t0, t1] of [[45, 0.6, 0.9], [40, 1.5, 1.8]] as const) {
      const f = hz(m);
      const withBuzz = highShare(pluck(spec, f, SR, 7), f, t0, t1);
      const without = highShare(pluck({ ...spec, buzz: undefined }, f, SR, 7), f, t0, t1);
      expect(withBuzz, `${m}：${withBuzz.toFixed(2)} 对 ${without.toFixed(2)}`).toBeGreaterThan(without * 1.3);
    }
    expect(pluck(spec, hz(40), SR, 7).length / SR).toBeGreaterThan(3.5);
  });

  it("恩戈尼的铁片：嗞嗞声让高次谐波多一些；科拉琴与克拉尔琴的皮面“噗”在各自的频率上", () => {
    const ng = pluckSpec("ngoni");
    const f = hz(57);
    expect(highShare(pluck(ng, f, SR, 7), f, 0.15, 0.3)).toBeGreaterThan(highShare(pluck({ ...ng, buzz: undefined }, f, SR, 7), f, 0.15, 0.3) * 1.05);
    const g = hz(64);
    for (const [k, at] of [["kora", 160], ["krar", 210]] as const) {
      const s = pluckSpec(k);
      expect(power(pluck(s, g, SR, 2), at, 0, 0.06), k).toBeGreaterThan(power(pluck({ ...s, skin: undefined }, g, SR, 2), at, 0, 0.06) * 1.4);
    }
  });

  it("恩桑比弓琴（棕榈纤维的弦、小木箱）比科拉琴、克拉尔琴暗得多；恩戈尼的余音最短", () => {
    const f = hz(57);
    const share = (k: string) => highShare(pluck(pluckSpec(k), f, SR, 7), f, 0.3, 0.45);
    expect(share("kora")).toBeGreaterThan(share("nsambi") * 2.5);
    expect(share("krar")).toBeGreaterThan(share("nsambi") * 2.5);
    const len = (k: string) => pluck(pluckSpec(k), f, SR, 7).length;
    expect(len("ngoni")).toBeLessThan(len("krar"));
    expect(len("krar")).toBeLessThan(len("kora"));
  });
});

describe("非洲的地方乐器：击奏", () => {
  it("马丁巴与巴拉丰的葫芦膜：2 千赫以上的能量多出两倍以上，嗡声比乐音先消失，音高不变；巴拉丰比马丁巴更“炸”", () => {
    const f = hz(60);
    const hf = (s: MalletSpec, a: number, b: number) => 1 - lowShare(mallet(s, f, SR, 3), 2000, Math.floor(a * SR), Math.floor(b * SR));
    const ratio: Record<string, number> = {};
    for (const k of ["madimba", "balafon"]) {
      const spec = malletSpec(k);
      expect(spec.buzz, k).toBeTruthy();
      const plain = { ...spec, buzz: undefined };
      ratio[k] = hf(spec, 0, 0.15) / hf(plain, 0, 0.15);
      expect(ratio[k], `${k}：${ratio[k].toFixed(2)} 倍`).toBeGreaterThan(2);
      // 嗡声先消失：后段（0.2–0.35 秒）高频的倍数比前段小
      expect(hf(spec, 0.2, 0.35) / hf(plain, 0.2, 0.35), k).toBeLessThan(ratio[k]);
      const x = mallet(spec, f, SR, 3);
      const p = pitchOf(x, 2000, 3000, f * 0.6, f * 1.6);
      expect(Math.abs(1200 * Math.log2(p / f)), `${k} ${p.toFixed(1)} Hz`).toBeLessThan(25);
    }
    expect(ratio.balafon).toBeGreaterThan(ratio.madimba);
  });

  it("利肯贝：铁环沙沙声与嗡都有，2.5 千赫以上比去掉铁环时多三倍以上；比斯瓦希里的拇指琴余音长、杂响多", () => {
    const spec = malletSpec("likembe");
    expect(spec.rattle && spec.buzz).toBeTruthy();
    const a = mallet(spec, hz(55), SR, 6);
    const b = mallet({ ...spec, rattle: undefined }, hz(55), SR, 6);
    expect(1 - lowShare(a, 2500)).toBeGreaterThan((1 - lowShare(b, 2500)) * 3);
    const kal = malletSpec("kalimba");
    expect(spec.rattle!.level).toBeGreaterThan(kal.rattle!.level);
    expect(spec.partials[0][2]).toBeGreaterThan(kal.partials[0][2]);
  });

  it("马丁巴与巴拉丰的长音是滚奏（!trem!）", () => {
    for (const k of ["madimba", "balafon"]) {
      const i = inst(k);
      expect(i.kind === "mallet" && (i.roll ?? 0) >= 10, k).toBe(true);
    }
  });
});

describe("非洲的地方乐器：鼓点", () => {
  it("鼓心的低音（凯贝罗、刚果的恩戈马、金贝鼓、敦巴、桑班）能量在低频；拍音、拍手、叉铃、沙铃、铁铃在高处", () => {
    for (const h of ["kebero_dum", "ngoma_kongo", "djembe_bass", "dundun_ba", "dundun_sang"]) expect(lowShare(drum(REGIONAL_DRUMS[h], SR, 1), 250), h).toBeGreaterThan(0.75);
    for (const h of ["kebero_slap", "ngoma_kongo_slap", "djembe_slap", "chebchebba", "tsenatsil", "nsakala", "shekere", "dundun_bell", "ngongi_hi"]) {
      expect(lowShare(drum(REGIONAL_DRUMS[h], SR, 1), 500), h).toBeLessThan(0.3);
    }
    // 三种手法由低到高：低音 < 开音 < 拍音
    const low = (h: string) => lowShare(drum(REGIONAL_DRUMS[h], SR, 1), 500);
    for (const [bass, tone, slap] of [["djembe_bass", "djembe_tone", "djembe_slap"], ["ngoma_kongo", "ngoma_kongo_tone", "ngoma_kongo_slap"], ["kebero_dum", "kebero_ta", "kebero_slap"]]) {
      expect(low(bass), bass).toBeGreaterThan(low(tone));
      expect(low(tone), tone).toBeGreaterThan(low(slap));
    }
  });

  it("说话鼓：平的高音与低音各自稳定；“往上滑”先停在低音再升到高音，“往下落”先停在高音再落下来", () => {
    // 基音（120–340 赫兹里功率最大的频率；1.5 倍的鼓皮泛音在这个范围之外）
    const at = (h: string, t0: number, t1: number) => peakFreq(drum(REGIONAL_DRUMS[h], SR, 1), t0, t1, 120, 340, 1);
    const hi = at("gangan_hi", 0.005, 0.05);
    const lo = at("gangan_lo", 0.005, 0.05);
    expect(hi / lo).toBeGreaterThan(1.5);
    expect(Math.abs(at("gangan_hi", 0.15, 0.25) / hi - 1)).toBeLessThan(0.05);
    expect(Math.abs(at("gangan_lo", 0.15, 0.25) / lo - 1)).toBeLessThan(0.05);
    // 往上滑：停留的 0.05 秒里还在低音附近，0.3 秒以后到了高音附近
    const upEarly = at("gangan_up", 0.005, 0.045);
    expect(upEarly / lo).toBeLessThan(1.1);
    expect(at("gangan_up", 0.3, 0.4) / upEarly).toBeGreaterThan(1.4);
    expect(Math.abs(at("gangan_up", 0.3, 0.4) / hi - 1)).toBeLessThan(0.08);
    // 往下落：停留的 0.06 秒里还在高音附近，0.35 秒以后落到了低音附近
    const downEarly = at("gangan_down", 0.005, 0.055);
    expect(Math.abs(downEarly / hi - 1)).toBeLessThan(0.08);
    expect(at("gangan_down", 0.35, 0.45) / downEarly).toBeLessThan(0.7);
    // 中间的颤：介于低音与高音之间
    const mid = at("gangan_mid", 0.15, 0.25);
    expect(mid).toBeGreaterThan(lo * 1.15);
    expect(mid).toBeLessThan(hi * 0.9);
  });

  it("鼓皮层的 hold：滑音前停在 f0，hold 之后才开始滑；不写 hold 时与原来一样（一敲就滑）", () => {
    const held = drum({ layers: [skin(200, 400, 0.02, 0.6, 1, undefined, undefined, 0.1)], vary: 0 }, SR, 1);
    expect(pitchOf(held, Math.floor(0.03 * SR), 1500, 100, 600)).toBeLessThan(215);
    expect(pitchOf(held, Math.floor(0.25 * SR), 1500, 100, 600)).toBeGreaterThan(370);
    const plain = drum({ layers: [skin(200, 400, 0.02, 0.6, 1)], vary: 0 }, SR, 1);
    expect(pitchOf(plain, Math.floor(0.08 * SR), 1500, 100, 600)).toBeGreaterThan(370);
    const zero = drum({ layers: [{ kind: "skin", f0: 200, f1: 400, bend: 0.02, decay: 0.6, level: 1, hold: 0 }], vary: 0 }, SR, 1);
    expect(zero.length).toBe(plain.length);
    for (let i = 0; i < plain.length; i += 97) expect(zero[i]).toBe(plain[i]);
  });

  it("铁铃有自己的音高：恩贡吉的高铃在 1180 赫兹附近、低铃更低；敦敦的铁铃更高；裂缝木鼓一高一低", () => {
    const ngHi = drum(REGIONAL_DRUMS.ngongi_hi, SR, 1);
    expect(Math.abs(peakFreq(ngHi, 0.01, 0.2, 1000, 1400) - 1180)).toBeLessThan(25);
    const ngLo = drum(REGIONAL_DRUMS.ngongi_lo, SR, 1);
    expect(peakFreq(ngLo, 0.01, 0.2, 700, 1000)).toBeLessThan(peakFreq(ngHi, 0.01, 0.2, 1000, 1400) * 0.8);
    expect(peakFreq(drum(REGIONAL_DRUMS.dundun_bell, SR, 1), 0.005, 0.1, 1800, 2600)).toBeGreaterThan(2000);
    const slit = (h: string) => pitchOf(drum(REGIONAL_DRUMS[h], SR, 1), 400, 2000, 120, 500);
    expect(slit("nkonko_hi") / slit("nkonko_lo")).toBeGreaterThan(1.25);
  });
});

describe("非洲的地方乐器：吹奏与弓弦", () => {
  const ratio = (k: string, n: number, f0 = 440) => sustain(k).amps(n, n * f0) / sustain(k).amps(1, f0);

  it("马森果是弓弦，滑音长，马尾的弓噪（跟着波形的噪声）比二胡、克曼切都重", () => {
    const m = sustain("masenqo");
    expect(m.kind).toBe("bowed");
    expect(m.glide).toBeGreaterThan(0.05);
    for (const k of ["erhu", "kemence"]) expect(m.pulse!.level, k).toBeGreaterThan(sustain(k).pulse!.level * 1.5);
  });

  it("瓦辛特笛与坦宾笛是气多的笛子：气声比陶笛多得多、比双簧管暗；姆蓬吉是嘴唇吹响的号（铜管一类，力度大时变亮）", () => {
    const air = (k: string) => (sustain(k).breath?.level ?? 0) + (sustain(k).pulse?.level ?? 0);
    expect(air("washint")).toBeGreaterThan(air("ocarina") * 2);
    // 坦宾笛（富拉笛）一边吹一边哼：气声与喉音都重，跟着波形的噪声贴着基音（比瓦辛特笛、尺八都低）
    expect(air("tambin")).toBeGreaterThan(air("ocarina") * 2);
    for (const k of ["washint", "shakuhachi"]) expect(sustain("tambin").pulse!.ratio, k).toBeLessThan(sustain(k).pulse!.ratio);
    expect(sustain("washint").kind).toBe("wind");
    const bright = (k: string) => [6, 8, 10].reduce((s, n) => s + ratio(k, n), 0);
    for (const reed of ["zurna", "suona", "zumari"]) expect(bright(reed), reed).toBeGreaterThan(bright("washint") * 3);
    const horn = sustain("mpungi");
    expect(horn.kind).toBe("brass");
    expect(horn.blare && horn.blare.to > horn.blare.from).toBe(true);
  });
});

describe("贝宁湾的乐器（评审后补：瓜托的一首不再借曼丁的乐器）", () => {
  it("登记：阿克帕塔弓琴、埃戈戈铁双铃、伊亚伊卢母鼓、古杜古杜小锅鼓，都属于几内亚海岸", () => {
    const akpata = REGIONAL.find((d) => d.key === "akpata");
    expect(akpata?.region).toBe("guinea");
    expect(inst("akpata").kind).toBe("pluck");
    const hits = ["egogo_hi", "egogo_lo", "iya_hi", "iya_lo", "iya_up", "iya_down", "iya_mid", "gudugudu_lo", "gudugudu_hi"];
    for (const h of hits) {
      expect(REGIONAL_DRUMS[h], h).toBeTruthy();
      expect(REGIONAL.find((d) => Object.keys(d.drums ?? {}).includes(h))?.region, h).toBe("guinea");
    }
  });

  it("阿克帕塔（木箱上的弓琴）：比刚果的恩桑比亮、余音长，比科拉琴暗，没有科拉琴牛皮的“噗”", () => {
    const f = hz(57);
    const share = (k: string) => highShare(pluck(pluckSpec(k), f, SR, 7), f, 0.3, 0.45);
    expect(share("akpata")).toBeGreaterThan(share("nsambi") * 2);
    expect(share("akpata")).toBeLessThan(share("kora") * 0.85);
    const len = (k: string) => pluck(pluckSpec(k), f, SR, 7).length;
    expect(len("akpata")).toBeGreaterThan(len("nsambi") * 1.3);
    expect(pluckSpec("akpata").skin).toBeUndefined();
  });

  it("伊亚伊卢（说话鼓的母鼓）比甘甘低一大截、余音长；同样会往上滑、往下落", () => {
    const at = (h: string, t0: number, t1: number) => peakFreq(drum(REGIONAL_DRUMS[h], SR, 1), t0, t1, 90, 340, 1);
    const hi = at("iya_hi", 0.005, 0.05);
    const lo = at("iya_lo", 0.005, 0.05);
    expect(hi).toBeLessThan(at("gangan_hi", 0.005, 0.05) * 0.8);
    expect(lo).toBeLessThan(at("gangan_lo", 0.005, 0.05) * 0.8);
    expect(hi / lo).toBeGreaterThan(1.5);
    const upEarly = at("iya_up", 0.005, 0.05);
    expect(upEarly / lo).toBeLessThan(1.1);
    expect(at("iya_up", 0.3, 0.4) / upEarly).toBeGreaterThan(1.4);
    const downEarly = at("iya_down", 0.005, 0.06);
    expect(Math.abs(downEarly / hi - 1)).toBeLessThan(0.08);
    expect(at("iya_down", 0.35, 0.45) / downEarly).toBeLessThan(0.7);
    expect(drum(REGIONAL_DRUMS.iya_lo, SR, 1).length).toBeGreaterThan(drum(REGIONAL_DRUMS.gangan_lo, SR, 1).length);
  });

  it("埃戈戈铁双铃比刚果的恩贡吉大、低（一大一小两只铃）；古杜古杜短而干，鼓心的“咚”在低处、膏外的“嗒”高一个八度", () => {
    const bell = (h: string) => peakFreq(drum(REGIONAL_DRUMS[h], SR, 1), 0.01, 0.2, 400, 1400);
    expect(Math.abs(bell("egogo_hi") - 760)).toBeLessThan(25);
    expect(bell("egogo_hi") / bell("egogo_lo")).toBeGreaterThan(1.25);
    expect(bell("egogo_hi")).toBeLessThan(bell("ngongi_lo"));
    const lo = drum(REGIONAL_DRUMS.gudugudu_lo, SR, 1);
    const hi = drum(REGIONAL_DRUMS.gudugudu_hi, SR, 1);
    expect(lo.length / SR).toBeLessThan(0.3);
    expect(lo.length).toBeLessThan(drum(REGIONAL_DRUMS.iya_lo, SR, 1).length * 0.6);
    expect(lowShare(lo, 500)).toBeGreaterThan(0.8);
    expect(lowShare(hi, 500)).toBeLessThan(lowShare(lo, 500));
    const pk = (x: Float32Array) => peakFreq(x, 0.003, 0.06, 120, 500, 1);
    expect(pk(hi) / pk(lo)).toBeGreaterThan(1.8);
  });
});
