// 地方乐器第二阶段·东亚宫廷：日本的雅乐与能乐（笙、乐琵琶、乐筝、羯鼓、钓太鼓、钲鼓、能管、大鼓），明的文人与节庆（古琴的按音、泛音与走手音，
// 曲笛与大笛，云锣，拍板）——登记，以及每件合成出来的声音的“签名”：笙的音簇比明的笙起音慢、暗；乐琵琶与乐筝比萨摩琵琶与俗筝暗；
// 羯鼓、大鼓与拍板在高处，钓太鼓在低处、比长胴太鼓软而长；钲鼓的分音不协和、比当钲响得久；能管的气声、起音的一口气与音高的游移都比龙笛多；
// 古琴的泛音几乎是正弦、走手音没有新的起音；曲笛比梆笛暗、大笛更暗；云锣音高准、只往上翘一点点。
// 确定性、没有非数、峰值归一、音高与衰减由 regional.test.ts 对每件乐器统一检查。
import { describe, expect, it } from "vitest";
import { drum, mallet, pluck, type DrumSpec, type MalletSpec, type PluckSpec } from "../../dsp";
import type { Instrument, SustainSpec } from "../../instruments";
import { lineOf } from "../../score";
import { demoTrack, REGIONAL, REGIONAL_DRUMS, REGIONAL_INSTRUMENTS, regionalId } from ".";

const SR = 44100;
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** 这一阶段新加的乐器（标识 → 地区）。 */
const NEW: Readonly<Record<string, "japan" | "ming">> = {
  sho: "japan",
  gakubiwa: "japan",
  gakuso: "japan",
  kakko: "japan",
  tsuri_me: "japan",
  shoko: "japan",
  nohkan: "japan",
  otsuzumi: "japan",
  guqin: "ming",
  guqin_fan: "ming",
  guqin_zou: "ming",
  qudi: "ming",
  dadi: "ming",
  yunluo: "ming",
  paiban: "ming",
};

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
function hit(name: string): DrumSpec {
  const d = REGIONAL_DRUMS[name];
  if (!d) throw new Error(name);
  return d;
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

/** [t0, t1) 秒里第 4 次及以上谐波占前 30 个谐波的能量比例。 */
function upperShare(x: Float32Array, f: number, t0: number, t1: number): number {
  let lo = 0,
    hi = 0;
  for (let k = 1; k <= 30 && k * f < SR / 2.2; k++) {
    const p = power(x, k * f, t0, t1);
    if (k >= 4) hi += p;
    else lo += p;
  }
  return hi / (lo + hi);
}

/** 一阶低通把信号分成 f 以下与以上：低频占的能量比例。 */
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

/** 吹奏的亮度：第 6、8、10 次谐波相对基频的振幅之和（f0 = 440 Hz）。 */
function brightness(key: string): number {
  const s = sustain(key);
  return [6, 8, 10].reduce((sum, n) => sum + s.amps(n, n * 440) / s.amps(1, 440), 0);
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

describe("东亚宫廷的地方乐器：登记", () => {
  it("十五件都登记了，地区对得上；鼓点合进了鼓点表，键合进了乐器表", () => {
    for (const [id, region] of Object.entries(NEW)) {
      const def = REGIONAL.find((d) => regionalId(d) === id);
      expect(def, id).toBeTruthy();
      expect(def!.region, id).toBe(region);
      if (def!.key) expect(REGIONAL_INSTRUMENTS[def!.key], id).toBe(def!.instrument);
      for (const [name, spec] of Object.entries(def!.drums ?? {})) expect(REGIONAL_DRUMS[name], name).toBe(spec);
    }
    // 只有鼓点的：羯鼓（正、来）、钓太鼓（图、咚）、大鼓（重、轻）、拍板
    for (const h of ["kakko", "kakko_rai", "tsuri_me", "tsuri_o", "otsuzumi", "otsuzumi_lt", "paiban"]) expect(REGIONAL_DRUMS[h], h).toBeTruthy();
  });

  it("笙的音色样本是合竹：每个音簇五六个音、四度五度里夹着二度", () => {
    const def = REGIONAL.find((d) => d.key === "sho")!;
    const t = demoTrack(def);
    const notes = lineOf(t, "A", "m").notes;
    expect(notes.length).toBeGreaterThanOrEqual(4);
    for (const n of notes) {
      expect(n.pitches.length).toBeGreaterThanOrEqual(5);
      const sorted = [...n.pitches].sort((a, b) => a - b);
      const steps = sorted.slice(1).map((p, i) => p - sorted[i]);
      expect(steps.some((s) => s <= 2), `二度：${sorted.join(" ")}`).toBe(true);
      expect(steps.some((s) => s >= 5), `四度以上：${sorted.join(" ")}`).toBe(true);
    }
  });
});

describe("日本的雅乐与能乐", () => {
  it("笙（雅乐）比明的笙起音慢、没有揉音、高次谐波少（透明）", () => {
    const sho = sustain("sho");
    const sheng = sustain("sheng");
    expect(sho.kind).toBe("pad");
    expect(sho.attack).toBeGreaterThan(sheng.attack * 3);
    expect(sho.vib).toBeUndefined();
    expect(brightness("sho")).toBeLessThan(brightness("sheng") * 0.8);
  });

  it("乐琵琶：有轻的“嗡”（带“嗡”的余音高次谐波留得更久），比萨摩琵琶暗得多；余音长，扫弦的几根弦连着响", () => {
    const spec = pluckSpec("gakubiwa");
    const f = hz(52);
    const withBuzz = upperShare(pluck(spec, f, SR, 7), f, 0.5, 0.7);
    const without = upperShare(pluck({ ...spec, buzz: undefined }, f, SR, 7), f, 0.5, 0.7);
    expect(withBuzz, `${withBuzz.toFixed(3)} 对 ${without.toFixed(3)}`).toBeGreaterThan(without * 1.15);
    const satsuma = upperShare(pluck(pluckSpec("biwa"), f, SR, 7), f, 0.1, 0.3);
    const gaku = upperShare(pluck(spec, f, SR, 7), f, 0.1, 0.3);
    expect(gaku, `${gaku.toFixed(3)} 对萨摩琵琶 ${satsuma.toFixed(3)}`).toBeLessThan(satsuma * 0.7);
    const i = inst("gakubiwa");
    expect(i.kind === "pluck" && (i.release ?? 0) >= 1).toBe(true);
  });

  it("乐筝比俗筝（koto）暗：起音以后高次谐波少", () => {
    const f = hz(64);
    const so = upperShare(pluck(pluckSpec("gakuso"), f, SR, 3), f, 0.05, 0.25);
    const koto = upperShare(pluck(pluckSpec("koto"), f, SR, 3), f, 0.05, 0.25);
    expect(so, `${so.toFixed(3)} 对 ${koto.toFixed(3)}`).toBeLessThan(koto);
  });

  it("羯鼓、大鼓在高处；“来”比“正”短；大鼓干、短（不到 0.3 秒）", () => {
    for (const h of ["kakko", "kakko_rai"]) expect(lowShare(drum(hit(h), SR, 1), 300), h).toBeLessThan(0.25);
    for (const h of ["otsuzumi", "otsuzumi_lt"]) expect(lowShare(drum(hit(h), SR, 1), 500), h).toBeLessThan(0.2);
    expect(drum(hit("kakko_rai"), SR, 1).length).toBeLessThan(drum(hit("kakko"), SR, 1).length);
    expect(drum(hit("otsuzumi"), SR, 1).length / SR).toBeLessThan(0.3);
  });

  it("钓太鼓：能量在低频；槌头包着皮——起音比长胴太鼓软、余音更长", () => {
    const o = drum(hit("tsuri_o"), SR, 1);
    const me = drum(hit("tsuri_me"), SR, 1);
    const don = drum(hit("taiko_don"), SR, 1);
    for (const x of [o, me]) expect(lowShare(x, 250)).toBeGreaterThan(0.7);
    expect(o.length).toBeGreaterThan(don.length);
    // 头 2 毫秒里的能量相对 20–40 毫秒：包着皮的槌起得慢
    const early = (x: Float32Array) => energy(x, 0, Math.floor(0.002 * SR)) / energy(x, Math.floor(0.02 * SR), Math.floor(0.04 * SR));
    expect(early(o)).toBeLessThan(early(don));
  });

  it("钲鼓：分音不协和（不是整数倍），比当钲响得久", () => {
    const spec = malletSpec("shoko");
    expect(spec.partials.some(([r]) => r > 1 && Math.abs(r - Math.round(r)) > 0.1)).toBe(true);
    const f = hz(88);
    expect(mallet(spec, f, SR, 1).length).toBeGreaterThan(mallet(malletSpec("atarigane"), f, SR, 1).length);
  });

  it("能管比龙笛：气声与跟着波形的噪声更多、起音的一口气更猛、音高游移得更厉害、亮度推得更高", () => {
    const noh = sustain("nohkan");
    const ryu = sustain("ryuteki");
    const air = (s: SustainSpec) => (s.breath?.level ?? 0) + (s.pulse?.level ?? 0);
    expect(air(noh)).toBeGreaterThan(air(ryu) * 1.4);
    expect(noh.puff!.level).toBeGreaterThan((ryu.puff?.level ?? 0) * 2);
    expect(noh.drift!).toBeGreaterThan((ryu.drift ?? 0) * 2);
    expect(noh.blare!.to).toBeGreaterThan(ryu.blare!.to);
  });
});

describe("明的文人与节庆", () => {
  it("古琴：低、余音长；泛音几乎是正弦（高次谐波远少于按音），起音软", () => {
    const f = hz(67);
    const an = upperShare(pluck(pluckSpec("guqin"), f, SR, 5), f, 0.1, 0.4);
    const fan = upperShare(mallet(malletSpec("guqin_fan"), f, SR, 5), f, 0.1, 0.4);
    expect(fan, `泛音 ${fan.toFixed(4)} 对按音 ${an.toFixed(4)}`).toBeLessThan(an * 0.1);
    expect(fan).toBeLessThan(0.01);
    expect(malletSpec("guqin_fan").attack ?? 0).toBeGreaterThanOrEqual(0.003);
    // 2 秒处还有声音（丝弦的余音长）
    const x = pluck(pluckSpec("guqin"), hz(48), SR, 5);
    expect(x.length / SR).toBeGreaterThan(3);
    expect(energy(x, 2 * SR, 2.2 * SR)).toBeGreaterThan(0);
  });

  it("古琴的走手音：没有新的拨弦——头 10 毫秒几乎无声，按音一下就起来", () => {
    const f = hz(55);
    const rise = (x: Float32Array) => energy(x, 0, Math.floor(0.01 * SR)) / energy(x, Math.floor(0.08 * SR), Math.floor(0.12 * SR));
    const zou = rise(pluck(pluckSpec("guqin_zou"), f, SR, 5));
    const an = rise(pluck(pluckSpec("guqin"), f, SR, 5));
    expect(zou).toBeLessThan(0.1);
    expect(an).toBeGreaterThan(zou * 5);
  });

  it("曲笛比梆笛暗、大笛更暗；两支都有笛膜的“沙”（跟着波形的噪声在四倍频上，比平平的气声多）", () => {
    expect(brightness("qudi")).toBeLessThan(brightness("bangdi"));
    expect(brightness("dadi")).toBeLessThan(brightness("qudi"));
    for (const k of ["qudi", "dadi"]) {
      const s = sustain(k);
      expect(s.pulse!.ratio, k).toBeGreaterThanOrEqual(4);
      expect(s.pulse!.level, k).toBeGreaterThan(s.breath!.level);
    }
  });

  it("云锣：音高准（0.2–0.5 秒处离本音不到 30 音分），起音时只低一点点（往上翘不到半个半音）", () => {
    const f = hz(74);
    const x = mallet(malletSpec("yunluo"), f, SR, 2);
    const late = peakFreq(x, 0.2, 0.5, f * 0.95, f * 1.05, 0.5);
    expect(Math.abs(1200 * Math.log2(late / f))).toBeLessThan(30);
    const g = malletSpec("yunluo").glide!;
    expect(g.from).toBeLessThan(1);
    expect(g.from).toBeGreaterThan(Math.pow(2, -0.5 / 12));
  });

  it("拍板：高、脆、短，几片板一前一后地碰（噪声层不止一下）", () => {
    const x = drum(hit("paiban"), SR, 1);
    expect(lowShare(x, 500)).toBeLessThan(0.2);
    expect(x.length / SR).toBeLessThan(0.3);
    expect(hit("paiban").layers.some((l) => l.kind === "noise" && (l.taps ?? 1) >= 2)).toBe(true);
  });
});

describe("南音的三弦（10-11 复核：《闽海长风》B 段的南音补上三弦）", () => {
  it("登记在明的地区，是拨弦乐器", () => {
    const def = REGIONAL.find((d) => regionalId(d) === "sanxian");
    expect(def?.region).toBe("ming");
    expect(inst("sanxian").kind).toBe("pluck");
  });

  it("没有三味线那种碰琴颈的“嗞——”：余音（0.6–0.8 秒）里前三个谐波占的比例是三味线的两倍以上（高次谐波先消失）", () => {
    const f = hz(57);
    const san = 1 - upperShare(pluck(pluckSpec("sanxian"), f, SR, 4), f, 0.6, 0.8);
    const sha = 1 - upperShare(pluck(pluckSpec("shamisen"), f, SR, 4), f, 0.6, 0.8);
    expect(pluckSpec("sanxian").buzz).toBeUndefined();
    expect(san, `三弦 ${san.toFixed(3)} 对三味线 ${sha.toFixed(3)}`).toBeGreaterThan(sha * 2);
  });

  it("蟒皮的“嘣”：起音的头 60 毫秒里皮面的低音比琵琶（没有皮）重得多，也比三味线的猫皮低", () => {
    const f = hz(69);
    const thump = (key: string) => {
      const x = pluck(pluckSpec(key), f, SR, 4);
      return power(x, 150, 0, 0.06) / power(x, f, 0, 0.06);
    };
    const san = thump("sanxian");
    const pipa = thump("pipa");
    expect(san, `三弦 ${san.toExponential(2)} 对琵琶 ${pipa.toExponential(2)}`).toBeGreaterThan(pipa * 3);
    expect(pluckSpec("sanxian").skin![0]).toBeLessThan(pluckSpec("shamisen").skin![0]);
  });

  it("余音比琵琶短：0.6–0.8 秒处剩下的能量（相对起音）比琵琶少", () => {
    const f = hz(57);
    const tail = (key: string) => {
      const x = pluck(pluckSpec(key), f, SR, 4);
      return energy(x, Math.floor(0.6 * SR), Math.floor(0.8 * SR)) / energy(x, 0, Math.floor(0.1 * SR));
    };
    const san = tail("sanxian");
    const pipa = tail("pipa");
    expect(san, `三弦 ${san.toExponential(2)} 对琵琶 ${pipa.toExponential(2)}`).toBeLessThan(pipa);
  });
});
