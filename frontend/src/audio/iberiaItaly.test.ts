// 第九批配乐·地方特色第二阶段：文艺复兴的伊比利亚与意大利。
// - 乐器：十八个文件（维韦拉琴、鲁特琴、肖姆管、巴洪管、萨克布、短号、四种竖笛、维奥尔琴、三孔笛与塔博鼓、便携管风琴、簧管风琴、响板、阿杜菲方鼓、意大利铃鼓、小定音鼓）
//   的登记与声音的特征（每件乐器都另有 regional.test.ts 的通用检查：确定、没有非数、峰值、音高、衰减、谐波表）；
// - 曲目：两首新港口曲《橙花码头》《商馆与凉廊》与重编的《侯爵府的维韦拉》《圣文森特角的帆》《亚得里亚的帆影》由这些乐器领奏，
//   维兰西科的叠句与小节（福利亚与罗曼内斯卡的低音、六三交替、皮卡第三度）、坎佐纳的开头与分开的合唱（两边轮流、最后合起来）、装饰变奏的骨干音；
// - 港口曲的对应：伊比利亚与意大利的风格名有自己的港口曲，希腊照旧回退；十六世纪世界的真实势力（style 写的是粗分的 mediterranean）按势力 key 选到新港口曲，
//   别的势力、经典世界与测试世界照旧；
// - 声部进行：坎佐纳、分开的合唱与维兰西科叠句里逐个写出的声部之间没有平行八度、平行五度（同向与反向都算）；装饰变奏在 A 大三和弦上写还原 B；
// - 经典世界的配乐逐采样不变：经典曲目（两套编配）的曲谱与每一遍展开的结果、原有乐器与鼓点的参数与合成出来的声音，与改动之前记下的指纹一致。
import { describe, expect, it } from "vitest";
import classicFactionsToml from "../../../data/factions.toml?raw";
import { styleOf } from "../art/buildings";
import type { Overview, StaticView } from "../ipc/types";
import { overview, statics } from "../test/fixtures";
import { sceneOf } from "./director";
import { biquad, drum, filter, mallet, pluck, type PluckSpec } from "./dsp";
import { usesSamples } from "./engine";
import { CORE_DRUMS, CORE_INSTRUMENTS, INSTRUMENTS, type SustainSpec } from "./instruments";
import { REGIONAL, REGIONAL_DRUMS, REGIONAL_INSTRUMENTS, regionalId } from "./instruments/regional";
import { isOrchestral } from "./orchestra/instruments";
import { ORCH_JINGLES, ORCH_TRACKS } from "./orchestra/tracks";
import { barUnits, chordsOf, lineOf, realizePass, seedOf, type TrackDef } from "./score";
import { pc } from "./theory";
import { TRACK_IDS, TRACKS, type TrackId } from "./tracks";
import { CUE_IDS, JINGLES } from "./tracks/jingles";
import { PORT_STYLE_TRACK, portTrackOf } from "./zones";

const SR = 44100;
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

const KEYS = ["vihuela", "liuto", "shawm", "bajon", "sackbut", "cornett", "rec_soprano", "rec_alto", "rec_tenor", "rec_bass", "gamba", "pipe", "organetto", "regal"] as const;
const HITS = ["tambori", "tambori_soft", "castanet", "castanet_lo", "castanet_roll", "adufe", "adufe_tek", "tamburello", "tamburello_shake", "naker_hi", "naker_lo"] as const;
const RECORDERS = ["rec_soprano", "rec_alto", "rec_tenor", "rec_bass"] as const;
/** 这一阶段的曲目：两首新港口曲与三首重编的曲子。 */
const TRACKS2: readonly TrackId[] = ["port_iberia", "port_italy", "ac_seville", "sea_iberia", "sea_med"];

function sustain(key: string): SustainSpec {
  const i = INSTRUMENTS[key];
  if (i.kind === "pluck" || i.kind === "mallet" || i.kind === "perc") throw new Error(key);
  return i;
}
function pluckSpec(key: string): PluckSpec {
  const i = INSTRUMENTS[key];
  if (i.kind !== "pluck") throw new Error(key);
  return i.spec;
}
const ratio = (k: string, n: number, f0 = 220) => sustain(k).amps(n, n * f0) / sustain(k).amps(1, f0);
/** 第 6、8、10 个谐波相对基音的振幅之和（越大越亮）。 */
const bright = (k: string, f0 = 220) => [6, 8, 10].reduce((s, n) => s + ratio(k, n, f0), 0);

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
function peakFreq(x: Float32Array, t0: number, t1: number, lo: number, hi: number): number {
  let best = 0;
  let at = lo;
  for (let f = lo; f <= hi; f++) {
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
/** 2 kHz 以上的部分：80–200 毫秒的能量相对头 30 毫秒（响弦、豆子、铃片拖出来的那一阵）。 */
function rattleTail(x: Float32Array): number {
  const hp = Float32Array.from(x);
  filter(hp, biquad("highpass", 2000, 0.7, 0, SR));
  return energy(hp, 0.08 * SR, 0.2 * SR) / energy(hp, 0, 0.03 * SR);
}

describe("第二阶段的地方乐器：登记", () => {
  const mine = REGIONAL.filter((d) => d.region === "iberia_italy");

  it("十八个文件，都在“伊比利亚与意大利”一区；十四件有音高的乐器与十一个鼓点都合进了乐器表与鼓点表，不与原有的重名", () => {
    expect(mine.length).toBe(18);
    expect(mine.flatMap((d) => (d.key ? [d.key] : [])).sort()).toEqual([...KEYS].sort());
    expect(mine.flatMap((d) => Object.keys(d.drums ?? {})).sort()).toEqual([...HITS].sort());
    for (const k of KEYS) {
      expect(Object.prototype.hasOwnProperty.call(CORE_INSTRUMENTS, k), k).toBe(false);
      expect(INSTRUMENTS[k], k).toBe(REGIONAL_INSTRUMENTS[k]);
    }
    for (const h of HITS) expect(Object.prototype.hasOwnProperty.call(CORE_DRUMS, h), h).toBe(false);
    // 三孔笛与塔博鼓是一个人的两件乐器：一个文件里既有笛子也有鼓点
    const pipe = mine.find((d) => d.key === "pipe")!;
    expect(Object.keys(pipe.drums ?? {})).toEqual(["tambori", "tambori_soft"]);
    expect(pipe.demo.abc && pipe.demo.drum?.length).toBeTruthy();
  });

  it("各件的种类：拨弦（维韦拉琴、鲁特琴）、吹奏（肖姆管、巴洪管、竖笛、三孔笛、便携管风琴）、铜管（萨克布、短号）、弓弦（维奥尔琴）、长音（簧管风琴）", () => {
    const kind = (k: string) => INSTRUMENTS[k].kind;
    for (const k of ["vihuela", "liuto"]) expect(kind(k), k).toBe("pluck");
    for (const k of ["shawm", "bajon", ...RECORDERS, "pipe", "organetto"]) expect(kind(k), k).toBe("wind");
    for (const k of ["sackbut", "cornett"]) expect(kind(k), k).toBe("brass");
    expect(kind("gamba")).toBe("bowed");
    expect(kind("regal")).toBe("pad");
  });
});

describe("第二阶段的地方乐器：声音的特征", () => {
  it("维韦拉琴是同度的复弦（没有八度弦），余音比原有的吉他短；鲁特琴有八度弦，余音比维韦拉琴还短", () => {
    const vih = pluckSpec("vihuela");
    const lute = pluckSpec("liuto");
    expect(vih.course ?? 0).toBeGreaterThan(0);
    expect(vih.octave).toBeUndefined();
    expect(lute.course ?? 0).toBeGreaterThan(0);
    expect(lute.octave ?? 0).toBeGreaterThan(0.2);
    // 1.0–1.5 秒的能量相对头 0.3 秒：越小余音越短
    const tail = (s: PluckSpec, m: number) => {
      const x = pluck(s, hz(m), SR, 3);
      return energy(x, SR, 1.5 * SR) / energy(x, 0, 0.3 * SR);
    };
    const guitar = (CORE_INSTRUMENTS.guitar as { spec: PluckSpec }).spec;
    for (const m of [57, 64]) {
      expect(tail(vih, m), `${m}`).toBeLessThan(tail(guitar, m) * 0.5);
      expect(tail(lute, m), `${m}`).toBeLessThan(tail(vih, m) * 0.6);
    }
  });

  it("文艺复兴的竖笛：几乎是正弦（第 2–5 个谐波都很弱），第二谐波不弱于第三（原有的 recorder 像巴洛克竖笛，第三谐波偏强）；尺寸越大气声越多、起音越慢", () => {
    for (const k of RECORDERS) {
      for (let n = 2; n <= 5; n++) expect(ratio(k, n), `${k} ${n}`).toBeLessThan(0.25);
      expect(ratio(k, 2), k).toBeGreaterThanOrEqual(ratio(k, 3));
    }
    expect(ratio("recorder", 3)).toBeGreaterThan(ratio("recorder", 2));
    const air = (k: string) => (sustain(k).breath?.level ?? 0) + (sustain(k).pulse?.level ?? 0);
    for (let i = 1; i < RECORDERS.length; i++) {
      expect(air(RECORDERS[i]), RECORDERS[i]).toBeGreaterThan(air(RECORDERS[i - 1]));
      expect(sustain(RECORDERS[i]).attack, RECORDERS[i]).toBeGreaterThan(sustain(RECORDERS[i - 1]).attack);
    }
    // 低音竖笛的音头有一口“噗”
    expect(sustain("rec_bass").puff).toBeTruthy();
  });

  it("三孔笛比竖笛尖、吐音更脆；便携管风琴不揉音、不滑音，两排管略有音差，风箱让音量轻轻起伏", () => {
    const mids = (k: string) => [2, 3, 4].reduce((s, n) => s + ratio(k, n), 0);
    for (const k of RECORDERS) {
      expect(mids("pipe"), k).toBeGreaterThan(mids(k) * 1.5);
      expect(sustain("pipe").chiff!, k).toBeGreaterThan(sustain(k).chiff!);
    }
    const org = sustain("organetto");
    expect(org.vib).toBeUndefined();
    expect(org.glide).toBeLessThan(0.01);
    expect(org.unison?.voices).toBe(2);
    expect(org.tremor!.depth).toBeLessThan(0.1);
  });

  it("双簧与铜管：肖姆管最亮（比竖笛亮得多，与祖尔纳同一族），短号比萨克布亮、比小号暗，巴洪管与萨克布是暗的低音", () => {
    for (const f0 of [131, 220, 440]) {
      for (const k of [...RECORDERS, "cornett", "sackbut", "bajon"]) expect(bright("shawm", f0), `${k} ${f0}`).toBeGreaterThan(bright(k, f0) * 2);
      expect(bright("cornett", f0), `${f0}`).toBeGreaterThan(bright("sackbut", f0));
      expect(bright("cornett", f0), `${f0}`).toBeLessThan(bright("trumpet", f0));
      for (const k of RECORDERS) expect(bright("cornett", f0), `${k} ${f0}`).toBeGreaterThan(bright(k, f0) * 10);
    }
    // 铜管的亮度包络：萨克布、短号的上限都比小号低（文艺复兴的铜管柔）
    expect(sustain("sackbut").blare!.to).toBeLessThan(sustain("trumpet").blare!.to);
    expect(sustain("cornett").blare!.to).toBeLessThan(sustain("trumpet").blare!.to);
    // 肖姆管几乎不揉音（欧洲的乐队要和声对得齐），祖尔纳揉得多
    expect(sustain("shawm").vib!.depth).toBeLessThan(sustain("zurna").vib!.depth);
    // 短号有一层气声（木管、号嘴），小号没有
    expect(sustain("cornett").breath!.level).toBeGreaterThan(0.01);
  });

  it("维奥尔琴：鼻音（1.1 kHz 一带）比大提琴重，揉音比提琴与大提琴浅，音与音之间分得开", () => {
    const nasal = (k: string) => sustain(k).amps(5, 1100) / sustain(k).amps(1, 220);
    expect(nasal("gamba")).toBeGreaterThan(nasal("cello") * 2);
    expect(sustain("gamba").vib!.depth).toBeLessThan(sustain("cello").vib!.depth);
    expect(sustain("gamba").vib!.depth).toBeLessThan(sustain("fiddle").vib!.depth);
    expect(sustain("gamba").tongue!).toBeLessThan(sustain("cello").tongue!);
  });

  it("簧管风琴：嗡嗡的簧音（高次谐波衰减得很慢，比弦乐群亮得多），起音快", () => {
    for (const f0 of [131, 220, 440]) expect(bright("regal", f0), `${f0}`).toBeGreaterThan(bright("strings", f0) * 4);
    expect(sustain("regal").attack).toBeLessThan(sustain("strings").attack / 10);
  });

  it("响板：几十毫秒、几乎全在 1 kHz 以上（比梆子还高）；意大利铃鼓以铃片为主", () => {
    for (const h of ["castanet", "castanet_lo", "castanet_roll"]) {
      const x = drum(REGIONAL_DRUMS[h], SR, 1);
      expect(x.length / SR, h).toBeLessThan(0.1);
      expect(lowShare(x, 1000), h).toBeLessThan(0.15);
      expect(lowShare(x, 1000), h).toBeLessThan(lowShare(drum(CORE_DRUMS.clapper, SR, 1), 1000));
    }
    for (const h of ["tamburello", "tamburello_shake"]) expect(lowShare(drum(REGIONAL_DRUMS[h], SR, 1), 1000), h).toBeLessThan(0.1);
  });

  it("阿杜菲方鼓：低的“嘭”，鼓里的豆子拖出一阵沙声（比本迪尔的响弦长）；塔博鼓的羊肠响弦比原有的 tabor 拖得长", () => {
    const adufe = drum(REGIONAL_DRUMS.adufe, SR, 1);
    expect(lowShare(adufe, 250)).toBeGreaterThan(0.5);
    expect(rattleTail(adufe)).toBeGreaterThan(rattleTail(drum(REGIONAL_DRUMS.bendir, SR, 1)) * 2);
    expect(rattleTail(drum(REGIONAL_DRUMS.tambori, SR, 1))).toBeGreaterThan(rattleTail(drum(CORE_DRUMS.tabor, SR, 1)) * 10);
  });

  it("小定音鼓有音高：高的一只约 268 Hz、低的约 180 Hz", () => {
    const hi = peakFreq(drum(REGIONAL_DRUMS.naker_hi, SR, 1), 0.1, 0.3, 120, 400);
    const lo = peakFreq(drum(REGIONAL_DRUMS.naker_lo, SR, 1), 0.1, 0.3, 120, 400);
    expect(Math.abs(hi / 268 - 1), `${hi}`).toBeLessThan(0.08);
    expect(Math.abs(lo / 180 - 1), `${lo}`).toBeLessThan(0.08);
  });

  it("每件的音色样本都能合成（拨弦与击奏直接合成：确定、峰值归一）", () => {
    for (const d of REGIONAL.filter((r) => r.region === "iberia_italy")) {
      expect(regionalId(d)).toBeTruthy();
      const i = d.key ? INSTRUMENTS[d.key] : null;
      if (i?.kind === "pluck") expect(Math.max(...pluck(i.spec, 220, SR, 1).map(Math.abs))).toBeCloseTo(0.8, 1);
      if (i?.kind === "mallet") expect(Math.max(...mallet(i.spec, 220, SR, 1).map(Math.abs))).toBeCloseTo(0.8, 1);
    }
  });
});

/** 这一区的乐器（含打击乐 perc）。 */
function iberianItalian(inst: string): boolean {
  if (inst === "perc") return true;
  return REGIONAL.some((d) => d.region === "iberia_italy" && d.key === inst);
}

/** 曲式里“旋律行:声部”用到的声部。 */
function melodyVoices(track: TrackDef): Set<string> {
  const out = new Set<string>();
  for (const form of track.forms) for (const st of form) for (const tok of st.play.split(/\s+/)) {
    const m = /^(\w+):(\w+)/.exec(tok);
    if (m) out.add(m[2]);
  }
  return out;
}

describe("第二阶段的曲目：伊比利亚与意大利的乐器领奏", () => {
  it("两首新港口曲登记在曲目表与管弦版里；合成版不用采样，管弦版用（衬底）", () => {
    for (const id of ["port_iberia", "port_italy"] as const) {
      expect(TRACK_IDS).toContain(id);
      expect(TRACKS[id].id).toBe(id);
      expect(ORCH_TRACKS[id].id).toBe(id);
      expect(usesSamples(TRACKS[id])).toBe(false);
      expect(usesSamples(ORCH_TRACKS[id])).toBe(true);
    }
    expect(TRACKS.port_iberia.title).toEqual({ zh: "橙花码头", en: "Quay of Orange Blossom" });
    expect(TRACKS.port_italy.title).toEqual({ zh: "商馆与凉廊", en: "Fondaco and Loggia" });
  });

  for (const id of TRACKS2) {
    it(`${id}：两套编配里每一条旋律都由伊比利亚与意大利的乐器奏；原来借的提琴、圆号、曼陀林、吉他、竖笛、大提琴都不再出现；衬底只有长音与低音的伴奏型，而且很轻`, () => {
      for (const track of [TRACKS[id], ORCH_TRACKS[id]]) {
        for (const v of melodyVoices(track)) expect(iberianItalian(track.voices[v].inst), `${id} 的 ${v}（${track.voices[v].inst}）`).toBe(true);
        for (const [name, v] of Object.entries(track.voices)) {
          expect(["fiddle", "violins", "horns", "horn", "mandolin", "guitar", "recorder", "lute", "cello", "harp"].includes(v.inst), `${id} 的 ${name}`).toBe(false);
          if (iberianItalian(v.inst)) continue;
          // 衬底：合成版的弦乐群与拨奏、管弦版的弦乐（采样），只有伴奏型，音量不超过 0.22
          expect(v.inst === "strings" || v.inst === "pizz" || isOrchestral(v.inst), `${id} 的 ${name}`).toBe(true);
          expect(v.gain ?? 0.5, `${id} 的 ${name}`).toBeLessThanOrEqual(0.22);
          expect(melodyVoices(track).has(name), `${id} 的 ${name}`).toBe(false);
        }
        // 至少三件这一区有音高的乐器（学院的短主题是室内的一把维韦拉琴与几把维奥尔：两件）
        const leads = new Set(Object.values(track.voices).map((v) => v.inst).filter((i) => i !== "perc" && iberianItalian(i)));
        expect(leads.size, id).toBeGreaterThanOrEqual(id === "ac_seville" ? 2 : 3);
      }
    });
  }

  it("《橙花码头》：G 小调 6/8；叠句是福利亚的低音、小节是罗曼内斯卡的低音；旋律里 6/8（两个附点四分）与 3/4（三个四分）交替；最后是 G 大三和弦（皮卡第三度）", () => {
    const t = TRACKS.port_iberia;
    expect(t.key).toBe("G minor");
    expect(t.meter).toEqual([6, 8]);
    const bar = barUnits(t.meter);
    const symbols = (s: string) => chordsOf(t.sections[s], bar).map((c) => c.chord.symbol);
    expect(symbols("estribillo").slice(0, 8)).toEqual(["Gm", "D", "Gm", "F", "Bb", "F", "Gm", "D"]);
    expect(symbols("copla").slice(0, 4)).toEqual(["Bb", "F", "Gm", "D"]);
    // 每小节的起音位置：3/4 是 0、2、4，6/8 有 3
    const onsets = (line: string) => {
      const notes = lineOf(t, "estribillo", line).notes;
      return Array.from({ length: 16 }, (_, b) => notes.filter((n) => n.at >= b * bar && n.at < (b + 1) * bar).map((n) => n.at - b * bar));
    };
    const mel = onsets("mel");
    expect(mel.some((o) => o.join() === "0,2,4")).toBe(true);
    expect(mel.some((o) => o.includes(3) && !o.includes(2))).toBe(true);
    // 尾声：最后的和弦是 G 大三和弦，旋律落在还原 B 上
    const coda = chordsOf(t.sections.coda, bar);
    expect(coda[coda.length - 1].chord.symbol).toBe("G");
    const end = lineOf(t, "coda", "end").notes;
    expect(pc(end[end.length - 1].pitches[0])).toBe(11);
    // 三孔笛与塔博鼓开场，叠句有“高音乐队”（肖姆管、萨克布）与“低音乐队”（竖笛、维韦拉琴）两种配器
    expect(t.forms[0][0].play).toContain("call:pipe");
    const plays = t.forms.flat().map((s) => s.play).join(" ");
    for (const v of ["shawm", "sackbut", "recs", "vihuela", "cast", "adufe", "bajon", "gamba"]) expect(plays, v).toContain(v);
  });

  it("《商馆与凉廊》：G 混合利底亚 4/4；坎佐纳的开头是“长—短—短”的同音；分开的合唱两边轮流（第一合唱第 1–2、5–6 小节，第二合唱第 3–4 小节回声），最后两小节一起终止", () => {
    const t = TRACKS.port_italy;
    expect(t.key).toBe("G mixolydian");
    const intro = lineOf(t, "intro", "s").notes;
    expect(intro.slice(0, 3).map((n) => n.len)).toEqual([4, 2, 2]);
    expect(new Set(intro.slice(0, 3).map((n) => n.pitches[0])).size).toBe(1);
    const bar = barUnits(t.meter);
    const barsOf = (line: string) => [...new Set(lineOf(t, "B", line).notes.map((n) => Math.floor(n.at / bar)))].sort();
    for (const l of ["s1", "a1", "t1", "b1"]) expect(barsOf(l), l).toEqual([0, 1, 4, 5, 6, 7]);
    for (const l of ["s2", "a2", "t2", "b2"]) expect(barsOf(l), l).toEqual([2, 3, 6, 7]);
    // 第一合唱是短号与萨克布，第二合唱是竖笛与便携管风琴
    const b = t.forms[0].find((s) => s.s === "B")!.play;
    for (const tok of ["s1:cornett", "b1:sbb", "s2:recs", "s2:organ", "b2:recb"]) expect(b).toContain(tok);
    expect(t.voices.cornett.pan! < 0 && t.voices.recs.pan! > 0).toBe(true);
    // 混合利底亚：还原 F（F 大三和弦）在曲子里
    expect(chordsOf(t.sections.B, bar).some((c) => c.chord.symbol === "F")).toBe(true);
    // 尾声是变格终止（C → G）
    expect(chordsOf(t.sections.coda, bar).map((c) => c.chord.symbol)).toEqual(["C", "G"]);
  });

  it("《侯爵府的维韦拉》：装饰变奏（glosas）的骨干音落在原来的位置——每小节第一个音与原旋律相同，音更密", () => {
    const t = TRACKS.ac_seville;
    const bar = barUnits(t.meter);
    const mel = lineOf(t, "A", "mel").notes;
    const glosa = lineOf(t, "A", "glosa").notes;
    expect(glosa.length).toBeGreaterThan(mel.length * 2);
    for (let b = 0; b < 8; b++) {
      const first = (ns: typeof mel) => ns.find((n) => n.at === b * bar)!.pitches[0];
      expect(first(glosa), `第 ${b + 1} 小节`).toBe(first(mel));
    }
    expect(t.voices.vihuela.inst).toBe("vihuela");
    expect(t.voices.viol.inst).toBe("gamba");
  });

  it("两首航海曲重编后旋律与和声不变：段落、和弦、旋律行与重编之前一样（只换了乐器）", () => {
    // 重编之前的段落（和弦与旋律）的指纹
    const sectionsPrint = (t: TrackDef) => seedOf(JSON.stringify(t.sections)).toString(16);
    expect(sectionsPrint(TRACKS.sea_iberia)).toBe(SECTIONS_BEFORE.sea_iberia);
    expect(sectionsPrint(TRACKS.sea_med)).toBe(SECTIONS_BEFORE.sea_med);
  });
});

describe("第二阶段的港口曲：伊比利亚与意大利的风格名", () => {
  it("iberian、spanish、portuguese → 《橙花码头》；italian、venetian、genoese → 《商馆与凉廊》；希腊归黎凡特一组（《酒色的海湾》）", () => {
    for (const s of ["iberian", "spanish", "portuguese"]) {
      expect(PORT_STYLE_TRACK[s], s).toBe("port_iberia");
      expect(portTrackOf("x", s), s).toBe("port_iberia");
    }
    for (const s of ["italian", "venetian", "genoese"]) {
      expect(PORT_STYLE_TRACK[s], s).toBe("port_italy");
      expect(portTrackOf("x", s), s).toBe("port_italy");
    }
    // 希腊归黎凡特一组：整合后黎凡特一支给了它自己的《酒色的海湾》（原来是没有、回退到地中海，见 DECISIONS“测试期望值变更”）
    expect(PORT_STYLE_TRACK.greek).toBe("port_levant");
    expect(portTrackOf("x", "greek")).toBe("port_levant");
  });

  it("经典世界的势力与经典的建筑风格照旧", () => {
    expect(portTrackOf("cuilan", null)).toBe("port_mediterranean");
    expect(portTrackOf("x", "mediterranean")).toBe("port_mediterranean");
    expect(portTrackOf("x", "lowland")).toBe("port_lowland");
    expect(portTrackOf(undefined, undefined)).toBe("port_mediterranean");
  });
});

// ───────────────────────────── 十六世纪世界的真实势力

/** TOML 里 [[factions]] 条目的 key 与 style（只认独占一行的表头；缺 style 时为 null）。 */
function factionsIn(text: string): { key: string; style: string | null }[] {
  return text
    .split(/^\[\[factions\]\]\s*$/m)
    .slice(1)
    .map((block) => ({ key: /^key\s*=\s*"([^"]*)"/m.exec(block)?.[1] ?? "", style: /^style\s*=\s*"([^"]*)"/m.exec(block)?.[1] ?? null }));
}

const TERRA16_FILES = import.meta.glob<string>("../../../data/worlds/terra16/factions/*.toml", { query: "?raw", import: "default", eager: true });
const TERRA16 = Object.values(TERRA16_FILES).flatMap(factionsIn);
const CLASSIC_FACTIONS = factionsIn(classicFactionsToml);
const IBERIA_FACTIONS = ["portugal", "spain"];
const ITALY_FACTIONS = ["venice", "genoa", "tuscany", "papal_states", "savoy", "ragusa", "hospital"];

/** 测试的静态数据里，0 号势力换成给定的 key 与 style（0 号港口“澄港”属于它）。 */
function dockedWith(key: string, style: string | null): { s: StaticView; o: Overview } {
  const s: StaticView = { ...statics, factions: statics.factions.map((f, i) => (i === 0 ? { ...f, key, style } : f)) };
  const o: Overview = { ...overview, fleets: [{ ...overview.fleets[0], docked: 0 }] };
  return { s, o };
}

describe("第二阶段的港口曲：十六世纪世界的真实势力（按数据写的风格名）", () => {
  it("terra16 的势力数据读得到，葡萄牙、西班牙与七个意大利势力都在，style 写的是伊比利亚与意大利的细名", () => {
    // 配乐的数据接线（2026-10-11）：原来这九个势力写粗分的 mediterranean，由前端按势力 key 细分（PORT_FACTION_REFINE）；
    // 现在数据写 portuguese、spanish、venetian、genoese、italian，选曲只看风格名（见 DECISIONS“测试期望值变更”）
    expect(TERRA16.length).toBeGreaterThan(100);
    const want: Record<string, string> = {
      portugal: "portuguese",
      spain: "spanish",
      venice: "venetian",
      genoa: "genoese",
      tuscany: "italian",
      papal_states: "italian",
      savoy: "italian",
      ragusa: "italian",
      hospital: "italian",
    };
    for (const [key, style] of Object.entries(want)) expect(TERRA16.find((x) => x.key === key)?.style, key).toBe(style);
    // terra16 里放伊比利亚与意大利两首的势力正好是这九个
    const mine = TERRA16.filter((f) => ["port_iberia", "port_italy"].includes(portTrackOf(f.key, f.style)));
    expect(mine.map((f) => f.key).sort()).toEqual([...IBERIA_FACTIONS, ...ITALY_FACTIONS].sort());
  });

  it("葡萄牙、西班牙的港口放《橙花码头》，威尼斯、热那亚、托斯卡纳、教宗国、萨伏依、拉古萨、医院骑士团的港口放《商馆与凉廊》（带着数据里真实的 style，经 director 的场景选曲）", () => {
    for (const [keys, track] of [
      [IBERIA_FACTIONS, "port_iberia"],
      [ITALY_FACTIONS, "port_italy"],
    ] as const) {
      for (const key of keys) {
        const f = TERRA16.find((x) => x.key === key)!;
        expect(portTrackOf(f.key, f.style), key).toBe(track);
        const { s, o } = dockedWith(f.key, f.style);
        expect(sceneOf(true, s, o).track, key).toBe(track);
      }
    }
  });

  it("terra16 的其余势力不放这两首（新西班牙与秘鲁仍是拓荒者，奥斯曼仍是金角湾）", () => {
    for (const f of TERRA16) {
      if (IBERIA_FACTIONS.includes(f.key) || ITALY_FACTIONS.includes(f.key)) continue;
      expect(["port_iberia", "port_italy"], f.key).not.toContain(portTrackOf(f.key, f.style));
    }
    expect(portTrackOf("france", "mediterranean")).toBe("port_mediterranean");
    expect(portTrackOf("new_spain", "frontier")).toBe("port_frontier");
    expect(portTrackOf("peru", "frontier")).toBe("port_frontier");
    expect(portTrackOf("ottoman", "ottoman")).toBe("port_ottoman");
  });

  it("只看风格名，不认势力 key：写了什么风格就是什么风格的港口曲", () => {
    expect(portTrackOf("spain", "frontier")).toBe("port_frontier");
    expect(portTrackOf("venice", "ottoman")).toBe("port_ottoman");
    expect(portTrackOf("genoa", "nordic")).toBe("port_nordic");
    expect(portTrackOf("venice", "iberian")).toBe("port_iberia");
    expect(portTrackOf("spain", "italian")).toBe("port_italy");
    expect(portTrackOf("venice", "greek")).toBe("port_levant");
    // 没写风格、或写粗分的地中海：地中海的港口曲（原来按势力 key 细分成伊比利亚，见 DECISIONS“测试期望值变更”）
    expect(portTrackOf("spain", null)).toBe("port_mediterranean");
    expect(portTrackOf("spain", "mediterranean")).toBe("port_mediterranean");
    expect(portTrackOf("venice", "mediterranean")).toBe("port_mediterranean");
  });

  it("经典世界的六个势力与测试世界照旧：都是按粗分风格的经典港口曲", () => {
    expect(CLASSIC_FACTIONS.map((f) => f.key).sort()).toEqual(["bichao", "chisha", "cuilan", "jinsui", "shuangling", "yaohua"]);
    for (const f of CLASSIC_FACTIONS) {
      expect(portTrackOf(f.key, f.style), f.key).toBe(`port_${styleOf(f.key, f.style)}`);
      expect(portTrackOf(f.key, null), f.key).toBe(`port_${styleOf(f.key, null)}`);
    }
    for (const key of ["test_west", "test_east"]) expect(portTrackOf(key, null), key).toBe("port_mediterranean");
    // 测试的静态数据（翠岚、金穗）停港照旧
    const o: Overview = { ...overview, fleets: [{ ...overview.fleets[0], docked: 0 }] };
    expect(sceneOf(true, statics, o).track).toBe("port_mediterranean");
    expect(sceneOf(true, statics, { ...o, fleets: [{ ...o.fleets[0], docked: 1 }] }).track).toBe("port_lowland");
  });
});

// ───────────────────────────── 声部进行

/** 一条旋律行里有音高的音（取最低的一个音）。 */
function voiceNotes(t: TrackDef, section: string, line: string): { at: number; len: number; p: number }[] {
  return lineOf(t, section, line)
    .notes.filter((n) => n.pitches.length > 0)
    .map((n) => ({ at: n.at, len: n.len, p: Math.min(...n.pitches) }));
}

/** 两两声部之间的平行八度（含同度）与平行五度：相邻两个起音时刻两个声部都在动、前后都是同一种纯音程（同向与反向都算）。 */
function parallels(t: TrackDef, section: string, lines: readonly string[]): string[] {
  const out: string[] = [];
  const vs = lines.map((l) => voiceNotes(t, section, l));
  const at = (ns: { at: number; len: number; p: number }[], time: number) => ns.find((n) => n.at <= time && time < n.at + n.len)?.p ?? null;
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const times = [...new Set([...vs[i], ...vs[j]].map((n) => n.at))].sort((x, y) => x - y);
      for (let k = 0; k + 1 < times.length; k++) {
        const [a0, b0, a1, b1] = [at(vs[i], times[k]), at(vs[j], times[k]), at(vs[i], times[k + 1]), at(vs[j], times[k + 1])];
        if (a0 === null || b0 === null || a1 === null || b1 === null || a0 === a1 || b0 === b1) continue;
        const c0 = (((a0 - b0) % 12) + 12) % 12;
        const c1 = (((a1 - b1) % 12) + 12) % 12;
        if (c0 === c1 && (c0 === 0 || c0 === 7)) out.push(`${section} ${lines[i]}/${lines[j]} @${times[k]}→${times[k + 1]}`);
      }
    }
  return out;
}

describe("第二阶段的曲目：逐个写出的声部之间没有平行八度、平行五度", () => {
  it("《商馆与凉廊》：坎佐纳的引子与叠句、分开的合唱（两边各自）、弗罗托拉、阿门终止", () => {
    const t = TRACKS.port_italy;
    expect([
      ...parallels(t, "intro", ["s", "b"]),
      ...parallels(t, "A", ["s", "a", "t", "b"]),
      ...parallels(t, "B", ["s1", "a1", "t1", "b1"]),
      ...parallels(t, "B", ["s2", "a2", "t2", "b2"]),
      ...parallels(t, "C", ["fmel", "falto"]),
      ...parallels(t, "coda", ["es", "ea", "et", "eb"]),
    ]).toEqual([]);
  });

  it("《橙花码头》：叠句的旋律、中音与低音，尾声", () => {
    const t = TRACKS.port_iberia;
    expect([...parallels(t, "estribillo", ["mel", "alto", "bass"]), ...parallels(t, "coda", ["end", "endalto", "endbass"])]).toEqual([]);
  });

  it("《侯爵府的维韦拉》：装饰变奏第 7 小节在 A 大三和弦上走 A — 还原 B — 升 C — D（不出降 B 到升 C 的增二度）", () => {
    const t = TRACKS.ac_seville;
    const bar = barUnits(t.meter);
    const b7 = lineOf(t, "A", "glosa").notes.filter((n) => n.at >= 6 * bar && n.at < 7 * bar).map((n) => pc(n.pitches[0]));
    expect(b7.slice(0, 4)).toEqual([9, 11, 1, 2]);
  });
});

// ───────────────────────────── 经典世界的配乐不变

/** 经典世界用到的曲目（主题曲、七首航海曲、风暴、七首港口曲、海战）。 */
const CLASSIC = ["title", "sea", "sea_north", "sea_south", "sea_islands", "sea_east", "sea_new", "ocean", "storm", "port_mediterranean", "port_nordic", "port_lowland", "port_desert", "port_islands", "port_eastern", "port_frontier", "battle"] as const;

/** 曲目的指纹：声部、段落、曲式、整体参数与每一遍展开的全部音符事件。 */
function trackPrint(t: TrackDef): string {
  const parts: string[] = [JSON.stringify(t.voices), JSON.stringify(t.sections), JSON.stringify(t.forms), String(t.level ?? 1), String(t.space ?? 1), String(!!t.hall)];
  for (let p = 0; p < t.forms.length; p++) parts.push(JSON.stringify(realizePass(t, p)));
  return seedOf(parts.join("|")).toString(16);
}

/** 原有乐器的指纹：参数、谐波表（四个音区各 16 个谐波）、拨弦与击奏合成出来的采样。 */
function instPrint(key: string): string {
  const i = CORE_INSTRUMENTS[key] as unknown as Record<string, unknown>;
  const amps = typeof i.amps === "function" ? [131, 262, 523, 1047].flatMap((f0) => Array.from({ length: 16 }, (_, n) => (i.amps as (n: number, f: number) => number)(n + 1, (n + 1) * f0).toPrecision(10))) : [];
  let audio = "";
  if (i.kind === "pluck") audio = Array.from(pluck(i.spec as PluckSpec, 220, SR, 3)).map((v) => v.toFixed(6)).join(",");
  if (i.kind === "mallet") audio = Array.from(mallet(i.spec as Parameters<typeof mallet>[0], 220, SR, 2)).map((v) => v.toFixed(6)).join(",");
  return seedOf(JSON.stringify(i) + amps.join(",") + audio).toString(16);
}

/** 改动之前（第一阶段合并后的 main）记下的指纹。 */
const BEFORE = {
  tracks: { title: ["f8c62857", "7d66ec9e"], sea: ["850e873d", "483b6cc4"], sea_north: ["5bd0c0c7", "64462487"], sea_south: ["5944206", "7b8d8586"], sea_islands: ["8de6fa8f", "ad36cee9"], sea_east: ["ee18720e", "a3c33e91"], sea_new: ["2e100678", "7131087f"], ocean: ["f6f71b2", "135427ba"], storm: ["277dde01", "4286b4e"], port_mediterranean: ["de37a13d", "d9e1056e"], port_nordic: ["ed14b9f8", "8d7749bd"], port_lowland: ["f0ae15d3", "2f66b684"], port_desert: ["490e515b", "9c5cd6cb"], port_islands: ["ba86b80", "325796c6"], port_eastern: ["aa0a3fe0", "d4d10132"], port_frontier: ["fd21706d", "5ce03364"], battle: ["35f4f131", "71368ce"] },
  cues: { depart: ["6ff71849", "eba15e5a"], arrive: ["fbb39ebf", "ef5bc6c1"], discover: ["db613135", "d50ef20f"], fortune: ["38573d6d", "d23e0bd3"] },
  inst: { harp: "2eee2cd", lute: "74fb717b", guitar: "a0061f40", oud: "6dd5cdad", zheng: "cc272a90", ukulele: "3d6e3db7", mandolin: "7193abcc", cittern: "c3cb932e", harpsichord: "fd47f955", kantele: "9069c28f", pizz: "42d64f0d", bell: "caccb328", carillon: "eda2ba54", celesta: "c8c68eab", marimba: "8f28f6be", logdrum: "36290a04", timpani: "280f50c0", gong: "f646a604", perc: "6f9b7e83", flute: "908b0d37", recorder: "c866318c", ney: "bee3bde6", dizi: "de105e75", vivo: "75027f4", fiddle: "6dcf997f", cello: "dbbe6ffd", violins: "ca285712", celli: "780d41", horn: "e99f044c", horns: "6e0ca99c", trumpet: "8919ec35", reed: "2dc2119", strings: "2ef538dc", choir: "52d97a61", drone: "65ea0ed6" },
  drums: { bodhran: "b51fb30e", tip: "b5ddc970", tabor: "c68f9b52", doum: "76f39011", tek: "4779f0f0", ka: "ffac4669", riq: "33661d2b", shake: "32f14ebb", shaker: "b8e161ab", pahu: "22f7d7bd", woodblock: "57de6231", clapper: "c8784141", taiko: "3341da82", snare: "26cccfc8", cymbal: "cbb0246c", stomp: "4517c51" },
} as const;

/** 重编之前的两首航海曲的段落（和弦与旋律）的指纹。 */
const SECTIONS_BEFORE = { sea_iberia: "49df92e6", sea_med: "e3788c00" } as const;

describe("经典世界的配乐逐采样不变", () => {
  it("经典曲目（两套编配）的曲谱与每一遍展开的结果与改动之前一样", () => {
    for (const id of CLASSIC) expect([trackPrint(TRACKS[id]), trackPrint(ORCH_TRACKS[id])], id).toEqual(BEFORE.tracks[id]);
    for (const id of CUE_IDS) expect([trackPrint(JINGLES[id]), trackPrint(ORCH_JINGLES[id])], id).toEqual(BEFORE.cues[id]);
  });

  it("原有乐器与鼓点的参数、谐波表与合成出来的声音与改动之前一样，也没有多出或少掉", () => {
    expect(Object.keys(CORE_INSTRUMENTS)).toEqual(Object.keys(BEFORE.inst));
    for (const k of Object.keys(CORE_INSTRUMENTS)) expect(instPrint(k), k).toBe(BEFORE.inst[k as keyof typeof BEFORE.inst]);
    expect(Object.keys(CORE_DRUMS)).toEqual(Object.keys(BEFORE.drums));
    for (const [k, s] of Object.entries(CORE_DRUMS)) {
      const print = seedOf(JSON.stringify(s) + Array.from(drum(s, SR, 5)).map((v) => v.toFixed(6)).join(",")).toString(16);
      expect(print, k).toBe(BEFORE.drums[k as keyof typeof BEFORE.drums]);
    }
  });
});
