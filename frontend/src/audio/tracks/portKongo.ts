// 《贝币与棕榈布》：刚果与安哥拉的港口（刚果河口的姆平达、罗安达岛的贝壳——“恩津布”贝币、棕榈纤维织的布当钱用，象牙与铜从内陆下来）。
// 地方特色第二阶段·非洲：刚果的乐器领奏（复古合成版的衬底用合成的大提琴组与持续音）。旋律原创。
// G 上的五声（G A B D E），12/8 拍（每分钟 138 个四分音符），三对二的交错：
// 恩贡吉双铃一直敲 12/8 的“标准型”（x · x · x x · x · x · x），编筐沙铃沙沙地铺八分音符，恩戈马鼓的“咚”“通”“啪”落在附点四分音符上，
// 裂缝木鼓“笃、托”地报信。
// - 引子：两支姆蓬吉象牙号按音高分工地轮流（hocket）吹出国王的号声——一支号只吹两个音（低的一支 G 与 B，高的一支 D 与 E），
//   一支吹完另一支接上，合起来才是一句；裂缝木鼓应着；
// - A：利肯贝（拇指琴，铁环嗡嗡沙沙）两只拇指交替地转一个两小节的圈，恩桑比弓琴在下面拨；
// - B：一领众和——马丁巴（葫芦膜嗡嗡响的木琴）“领”两小节，弓琴“和”两小节；再来时低八度的马丁巴也来和，
//   两支象牙号只在“和”的句头、句尾各吹自己的音（G 与 D 的长音），不吹整条旋律；
// - C：两架马丁巴一人一音地咬合，拼出一条连续的快句；A 回来，号声收尾。
// 和声：不写西洋的三和弦，衬底只有 G–D 的空五度；利肯贝的圈与弓琴的伴奏型本身就是“和声”。
import type { TrackDef } from "../score";
import { byPitch, hocket } from "./weave";

/** 一小节的格子重复 n 遍（小节线分开）。 */
const rep = (bar: string, n: number) => Array.from({ length: n }, () => bar).join(" | ");

/** 利肯贝的圈（两小节）：左拇指在附点四分音符上拨低音，右拇指填在中间。 */
const OST = "G, d B, e D d A, B D e G, d | E, B G, d B, e A, B D d G, B";
/** 恩桑比弓琴的伴奏型（两小节）。 */
const NSOST = "G,3 D3 A,3 D3 | E,3 B,3 A,3 D3";
/** 象牙号的号声（引子）：两支号按音高分工（byPitch），合起来是这一句。 */
const HORN = "!bend!D6 B,3 D3 | !bend!E6 !fall!D6 | !bend!G,6 B,3 D3 | !fall!G,12";
/** 尾声的号声。 */
const HORN_END = "!bend!D6 B,3 D3 | !fall!G,12";
/** B 段再来时号的应和：只在“和”的句头、句尾吹 G 与 D 的长音（第 7 小节加一个 B 的过渡）。 */
const HORN_RESP = "z12 | z12 | !bend!G,6 !bend!D6 | z6 !fall!G,6 | z12 | z12 | !bend!D6 B,3 D3 | z6 !fall!G,6";
/** 低的一支号吹 G 与 B，高的一支吹 D 与 E——一支号只有两个音。 */
const LOW_HORN = ["G,", "B,"] as const;
const HIGH_HORN = ["D", "E"] as const;
/** C 段两架马丁巴合起来的快句（再一人一音地拆开）。 */
const WEAVE = "g e d e g d e d B d e d | e d B d e B d B A B d B | g e d e g d e d B d e g | a g e d e d B A G A B d";

export const PORT_KONGO: TrackDef = {
  id: "port_kongo",
  title: { zh: "贝币与棕榈布", en: "Shell Money and Raffia Cloth" },
  qpm: 138,
  meter: [12, 8],
  key: "G major",
  voices: {
    likembe: { inst: "likembe", gain: 0.5, pan: -0.18, reverb: 0.24 },
    madimba: { inst: "madimba", gain: 0.52, pan: 0.22, reverb: 0.26 },
    madimba2: { inst: "madimba", gain: 0.42, pan: -0.3, reverb: 0.26 },
    nsambi: { inst: "nsambi", gain: 0.45, pan: 0.3, reverb: 0.26 },
    horn1: { inst: "mpungi", gain: 0.42, pan: -0.22, reverb: 0.42 },
    horn2: { inst: "mpungi", gain: 0.4, pan: 0.26, reverb: 0.42 },
    bell: { inst: "perc", gain: 0.18, pan: 0.36, reverb: 0.26, pattern: { kind: "drum", steps: "L.h.hh.h.h.h", hits: { L: ["ngongi_lo", 0.7], h: ["ngongi_hi", 0.55] } } },
    rattle: { inst: "perc", gain: 0.18, pan: -0.36, reverb: 0.22, pattern: { kind: "drum", steps: "S.sS.sS.sS.s", hits: { S: ["nsakala", 0.55], s: ["nsakala_soft", 0.4] } } },
    ngoma: {
      inst: "perc",
      gain: 0.3,
      pan: 0.06,
      reverb: 0.24,
      pattern: {
        a: { kind: "drum", steps: "B..t.tB.st.t", hits: { B: ["ngoma_kongo", 0.75], t: ["ngoma_kongo_tone", 0.55], s: ["ngoma_kongo_slap", 0.55] } },
        b: { kind: "drum", steps: "B.tt.tB.stst", hits: { B: ["ngoma_kongo", 0.8], t: ["ngoma_kongo_tone", 0.58], s: ["ngoma_kongo_slap", 0.6] } },
        intro: {
          kind: "drum",
          steps: "B...........B...........B...........B..t.tB.stst",
          hits: { B: ["ngoma_kongo", 0.7], t: ["ngoma_kongo_tone", 0.5], s: ["ngoma_kongo_slap", 0.55] },
        },
        coda: { kind: "drum", steps: "B..t.tB.....B...........", hits: { B: ["ngoma_kongo", 0.85], t: ["ngoma_kongo_tone", 0.6] } },
      },
    },
    slit: {
      inst: "perc",
      gain: 0.24,
      pan: -0.12,
      reverb: 0.34,
      pattern: {
        intro: { kind: "drum", steps: "L..h..L.hh..L..h..LhLhhh", hits: { L: ["nkonko_lo", 0.7], h: ["nkonko_hi", 0.6] } },
        a: { kind: "drum", steps: "L.....L.h...", hits: { L: ["nkonko_lo", 0.55], h: ["nkonko_hi", 0.45] } },
        coda: { kind: "drum", steps: "L..h..L.....L...........", hits: { L: ["nkonko_lo", 0.75], h: ["nkonko_hi", 0.6] } },
      },
    },
    // 衬底（合成）：大提琴组拉 G 的长音，G–D 的空五度持续音
    low: { inst: "celli", gain: 0.2, pan: 0.12, reverb: 0.26 },
    pad: { inst: "drone", gain: 0.16, pan: -0.18, reverb: 0.42, pattern: { kind: "drone", notes: [43, 50] } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: rep("G5", 4),
      lines: { h0: byPitch(HORN, LOW_HORN), h1: byPitch(HORN, HIGH_HORN), root: rep("G,,12", 4) },
    },
    A: {
      bars: 4,
      chords: rep("G5", 4),
      lines: { ost: rep(OST, 2), nsost: rep(NSOST, 2), root: rep("G,,12", 4) },
    },
    B: {
      bars: 8,
      chords: rep("G5", 8),
      lines: {
        // 一领：马丁巴（长音用滚奏）
        call: "d2 d B2 d e2 e d2 d | B2 B A2 G !trem!A6 | z12 | z12 | e2 e d2 B d2 d e2 e | g2 e d2 B !trem!B6 | z12 | z12",
        // 众和：弓琴（再来时加上低八度的马丁巴）
        resp: "z12 | z12 | G2 G A2 B d2 d B2 B | A2 G E2 G G2 G G3 | z12 | z12 | B2 B d2 e d2 d B2 B | A2 B A2 G G2 G G3",
        // 再来时两支象牙号在“和”的句头、句尾各吹自己的音
        hr0: byPitch(HORN_RESP, LOW_HORN),
        hr1: byPitch(HORN_RESP, HIGH_HORN),
        ost: rep(OST, 4),
        root: rep("G,,12", 8),
      },
    },
    C: {
      bars: 4,
      chords: rep("G5", 4),
      lines: { m0: hocket(WEAVE, 0), m1: hocket(WEAVE, 1), ost: rep(OST, 2), root: rep("G,,12", 4) },
    },
    coda: {
      bars: 2,
      chords: "G5 | G5",
      lines: { e0: byPitch(HORN_END, LOW_HORN), e1: byPitch(HORN_END, HIGH_HORN), root: rep("G,,12", 2) },
    },
  },
  forms: [
    [
      { s: "intro", play: "h0:horn1 h1:horn2 slit.intro ngoma.intro root:low pad", dyn: 0.6, to: 0.68 },
      { s: "A", play: "ost:likembe nsost:nsambi bell rattle ngoma.a root:low pad", dyn: 0.66 },
      { s: "B", play: "call:madimba resp:nsambi ost:likembe bell rattle ngoma.a root:low pad", dyn: 0.68 },
      { s: "B", play: "call:madimba resp:nsambi resp:madimba2-12 hr0:horn1 hr1:horn2 ost:likembe bell rattle ngoma.b slit.a root:low pad", dyn: 0.72 },
      { s: "C", play: "m0:madimba m1:madimba2 ost:likembe bell rattle ngoma.b slit.a root:low pad", dyn: 0.74 },
      { s: "A", play: "ost:likembe nsost:nsambi bell rattle ngoma.a root:low pad", dyn: 0.68 },
      { s: "coda", play: "e0:horn1 e1:horn2 ngoma.coda slit.coda root:low", dyn: 0.7, rit: 0.9 },
    ],
    [
      { s: "A", play: "ost:likembe nsost:nsambi bell rattle ngoma.a root:low pad", dyn: 0.64 },
      { s: "B", play: "call:madimba resp:nsambi ost:likembe bell rattle ngoma.a root:low pad", dyn: 0.68 },
      { s: "C", play: "m0:madimba m1:madimba2 ost:likembe bell rattle ngoma.b slit.a root:low pad", dyn: 0.72 },
      { s: "coda", play: "e0:horn1 e1:horn2 ngoma.coda slit.coda root:low", dyn: 0.7, rit: 0.9 },
    ],
  ],
  rest: [10, 18],
  level: 1.15,
};
