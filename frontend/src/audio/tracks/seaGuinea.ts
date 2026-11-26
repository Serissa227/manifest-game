// 《赤道的长浪》：非洲西岸与南大西洋的航路（佛得角、几内亚湾的赤道无风带、刚果河口外、安哥拉与本格拉的寒流——
// 去黄金海岸、去姆平达与罗安达、再往南绕好望角的船都从这里过）。第九批寰宇世界用（音乐分区 west_africa / guinea / kongo / angola……，见 zones.ts）。
// 地方特色第二阶段·非洲：经典世界的《驼铃与海风》（沙漠海岸的希贾兹）不动，这一首另起，由非洲西岸的乐器领奏。旋律原创。
// D 混合利底亚（还原 C），6/8 拍（每分钟 100 个四分音符）——航海曲一贯的 6/8 摇晃，像长浪一下一下托着船：
// - 第一遍走几内亚湾（西非）：科拉琴在低处摇着分解的音型（D | G | D | A 的“地方”——曼丁的科拉琴确实是这样按“地方”勾出和声的），
//   开头两支姆蓬吉象牙号远远地吹起全作的起帆动机（A → D → A，一支吹两个 A、一支只吹 D）；
//   A 段巴拉丰（葫芦膜嗞嗞响）唱一条长浪似的旋律，长音用滚奏；B 段坦宾笛（富拉人的笛子，一边吹一边哼）唱更开阔的一句，
//   说话鼓在句子之间远远地“喊”；A 再来时巴拉丰与坦宾笛一起；
// - 第二遍往南走刚果与安哥拉的海岸（评审后改）：不再按“地方”换和声——利肯贝拇指琴转一个不跟和声走的两小节的圈
//   （像《贝币与棕榈布》的利肯贝），衬底只留主音 D 上的空五度；马丁巴唱旋律，恩贡吉双铃敲 6/8 的标准型、恩戈马鼓与沙铃推着；
//   A 再来时两支象牙号在句头、句尾各吹自己的一个音（一支 D、一支 A，像远处船上的号）——象牙号一支只吹一两个音，不吹整条旋律。
// 和声：第一遍的衬底只拉空五度（D–A、G–D、A–E、E–B），第二遍只有 D–A，都不写三和弦的长音。
import type { TrackDef } from "../score";
import { byPitch } from "./weave";

/** 一小节的格子重复 n 遍（小节线分开）。 */
const rep = (bar: string, n: number) => Array.from({ length: n }, () => bar).join(" | ");

/** 科拉琴摇晃的分解音型（每小节一个“地方”；只在第一遍）。 */
const K = { D: "D, A, D F A F", G: "G, D G B G D", A: "A, E A B A E", E: "E, B, E G E B," } as const;
type Area = keyof typeof K;
const seq = (areas: readonly Area[], table: Readonly<Record<Area, string>>) => areas.map((a) => table[a]).join(" | ");
/**
 * 利肯贝的圈（第二遍）：两只拇指交替，左拇指在低处走 D A B | E A G，右拇指在上面点 d e d | B d B——
 * 两小节一圈地转，不管旋律走到哪里，也不跟着换“地方”。
 */
const LK = "D, d A, e B, d | E, B A, d G, B";

const INTRO: readonly Area[] = ["D", "D", "D", "D"];
const A_AREAS: readonly Area[] = ["D", "G", "D", "A", "D", "G", "D", "A"];
const B_AREAS: readonly Area[] = ["G", "D", "G", "A", "G", "D", "E", "A"];
const ROOT: Readonly<Record<Area, string>> = { D: "D,,6", G: "G,,6", A: "A,,6", E: "E,,6" };
const chordsOf = (areas: readonly Area[]) => areas.map((a) => `${a}5`).join(" | ");

/** 起帆动机（A → D → A）：两支象牙号按音高分工——一支吹低处与高八度的 A，一支只吹 D。 */
const MOT = "z6 | z4 A,,3/2 D,/2 | !vib!A,6 | z6";
const MOT_A = byPitch(MOT, ["A,,", "A,"]);
const MOT_D = byPitch(MOT, ["D,"]);
/** 第二遍的旋律（马丁巴），与第一遍巴拉丰、坦宾笛的旋律同一条。 */
const MEL_A = "f2 e d2 A | B3 d2 B | A2 B d2 e | !trem!e6 | f2 a f2 e | d2 B G2 B | A2 B d2 c | !trem!d6";
const MEL_B = "d3 B2 A | A3 F2 E | G2 A B2 d | e6 | g3 f2 e | d3 B2 A | B2 A G2 E | A6";

export const SEA_GUINEA: TrackDef = {
  id: "sea_guinea",
  title: { zh: "赤道的长浪", en: "Equatorial Swells" },
  qpm: 100,
  meter: [6, 8],
  key: "D mixolydian",
  voices: {
    kora: { inst: "kora", gain: 0.4, pan: -0.22, reverb: 0.34 },
    tambin: { inst: "tambin", gain: 0.46, pan: 0.14, reverb: 0.42 },
    balafon: { inst: "balafon", gain: 0.46, pan: 0.24, reverb: 0.34 },
    likembe: { inst: "likembe", gain: 0.46, pan: -0.2, reverb: 0.32 },
    madimba: { inst: "madimba", gain: 0.5, pan: 0.22, reverb: 0.34 },
    horn1: { inst: "mpungi", gain: 0.4, pan: -0.06, reverb: 0.5 },
    horn2: { inst: "mpungi", gain: 0.36, pan: 0.2, reverb: 0.5 },
    gangan: {
      inst: "perc",
      gain: 0.3,
      pan: 0.3,
      reverb: 0.42,
      pattern: {
        intro: { kind: "drum", steps: "......l.lU.........D....", hits: { l: ["gangan_lo", 0.55], U: ["gangan_up", 0.7], D: ["gangan_down", 0.7] } },
        a: { kind: "drum", steps: "....................................l.lU.....D..", hits: { l: ["gangan_lo", 0.55], U: ["gangan_up", 0.7], D: ["gangan_down", 0.7] } },
        b: { kind: "drum", steps: "..................h.hU..................l.lD....", hits: { l: ["gangan_lo", 0.6], h: ["gangan_hi", 0.6], U: ["gangan_up", 0.75], D: ["gangan_down", 0.75] } },
        coda: { kind: "drum", steps: "U.....D.................", hits: { U: ["gangan_up", 0.7], D: ["gangan_down", 0.75] } },
      },
    },
    djembe: { inst: "perc", gain: 0.24, pan: -0.06, reverb: 0.3, pattern: { kind: "drum", steps: "B..t.t", hits: { B: ["djembe_bass", 0.6], t: ["djembe_tone", 0.42] } } },
    dundun: { inst: "perc", gain: 0.26, pan: 0.06, reverb: 0.28, pattern: { kind: "drum", steps: "B.....S.....", hits: { B: ["dundun_ba", 0.6], S: ["dundun_sang", 0.45] } } },
    shekere: { inst: "perc", gain: 0.18, pan: -0.34, reverb: 0.26, pattern: { kind: "drum", steps: "S.sS.s", hits: { S: ["shekere", 0.45], s: ["shekere_soft", 0.32] } } },
    bell: { inst: "perc", gain: 0.15, pan: 0.36, reverb: 0.3, pattern: { kind: "drum", steps: "L.h.hh.h.h.h", hits: { L: ["ngongi_lo", 0.6], h: ["ngongi_hi", 0.48] } } },
    rattle: { inst: "perc", gain: 0.16, pan: -0.36, reverb: 0.26, pattern: { kind: "drum", steps: "S.sS.s", hits: { S: ["nsakala", 0.48], s: ["nsakala_soft", 0.34] } } },
    ngoma: {
      inst: "perc",
      gain: 0.26,
      pan: 0.06,
      reverb: 0.28,
      pattern: {
        a: { kind: "drum", steps: "B..t.tB.st.t", hits: { B: ["ngoma_kongo", 0.65], t: ["ngoma_kongo_tone", 0.45], s: ["ngoma_kongo_slap", 0.45] } },
        coda: { kind: "drum", steps: "B.....B.................", hits: { B: ["ngoma_kongo", 0.7] } },
      },
    },
    slit: { inst: "perc", gain: 0.22, pan: -0.12, reverb: 0.4, pattern: { kind: "drum", steps: "L..h..L.hh..............", hits: { L: ["nkonko_lo", 0.55], h: ["nkonko_hi", 0.45] } } },
    // 衬底（合成）：大提琴组拉根音的长音，空五度的持续音跟着“地方”走
    low: { inst: "celli", gain: 0.16, pan: 0.12, reverb: 0.3 },
    pad: { inst: "drone", gain: 0.12, pan: -0.18, reverb: 0.46, pattern: { kind: "pad", low: 50, high: 64, size: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: chordsOf(INTRO),
      lines: {
        kost: seq(INTRO, K),
        lk: rep(LK, 2),
        // 全作的起帆动机（A → D → A），两支象牙号在低处远远地吹
        ma: MOT_A,
        md: MOT_D,
        root: seq(INTRO, ROOT),
      },
    },
    // 第一遍（几内亚湾）：科拉琴按“地方”摇
    A: {
      bars: 8,
      chords: chordsOf(A_AREAS),
      lines: {
        kost: seq(A_AREAS, K),
        mel: MEL_A,
        root: seq(A_AREAS, ROOT),
      },
    },
    B: {
      bars: 8,
      chords: chordsOf(B_AREAS),
      lines: {
        kost: seq(B_AREAS, K),
        bmel: MEL_B,
        root: seq(B_AREAS, ROOT),
      },
    },
    // 第二遍（刚果与安哥拉的海岸）：同样的旋律，下面只有利肯贝的圈与 D 上的空五度
    A2: {
      bars: 8,
      chords: rep("D5", 8),
      lines: {
        lk: rep(LK, 4),
        mel: MEL_A,
        // A 再来时的两支象牙号：一支只吹 D（句头与句尾），一支只吹低处的 A（句中的长音）
        hd: "!bend!D6 | z6 | z6 | z6 | !bend!D6 | z6 | z6 | !fall!D6",
        ha: "z6 | z6 | z6 | !bend!A,6 | z6 | z6 | z3 !bend!A,3 | z6",
        root: rep("D,,6", 8),
      },
    },
    B2: {
      bars: 8,
      chords: rep("D5", 8),
      lines: {
        lk: rep(LK, 4),
        bmel: MEL_B,
        root: rep("D,,6", 8),
      },
    },
    outro: {
      bars: 4,
      chords: chordsOf(INTRO),
      lines: {
        kost: seq(INTRO, K),
        lk: rep(LK, 2),
        ma: MOT_A,
        md: MOT_D,
        root: seq(INTRO, ROOT),
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "kost:kora ma:horn1 md:horn2 gangan.intro root:low pad", dyn: 0.55, to: 0.64 },
      { s: "A", play: "kost:kora mel:balafon djembe shekere root:low pad", dyn: 0.64 },
      { s: "A", play: "kost:kora mel:balafon djembe dundun shekere gangan.a root:low pad", dyn: 0.68 },
      { s: "B", play: "kost:kora bmel:tambin dundun shekere gangan.b root:low pad", dyn: 0.68, to: 0.72 },
      { s: "A", play: "kost:kora mel:balafon mel:tambin djembe dundun shekere root:low pad", dyn: 0.72 },
      { s: "outro", play: "kost:kora ma:horn1 md:horn2 gangan.coda root:low pad", dyn: 0.6, to: 0.4, rit: 0.85 },
    ],
    [
      { s: "intro", play: "lk:likembe ma:horn1 md:horn2 slit root:low pad", dyn: 0.55, to: 0.62 },
      { s: "A2", play: "lk:likembe mel:madimba bell rattle ngoma.a root:low pad", dyn: 0.64 },
      { s: "B2", play: "lk:likembe bmel:madimba bell rattle ngoma.a root:low pad", dyn: 0.66, to: 0.7 },
      { s: "A2", play: "lk:likembe mel:madimba hd:horn2 ha:horn1 bell rattle ngoma.a root:low pad", dyn: 0.7 },
      { s: "outro", play: "lk:likembe ma:horn1 md:horn2 ngoma.coda root:low pad", dyn: 0.58, to: 0.38, rit: 0.85 },
    ],
  ],
  rest: [25, 45],
  level: 1.28,
};
