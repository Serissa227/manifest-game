// 《丁香群岛的铜锣》：东南亚的海（马六甲海峡、爪哇海、摩鹿加——丁香与肉豆蔻的群岛）。
// E 上近似佩洛格的五声（E F G B C：带半音的那一种，十二平均律里的近似），4/4 拍（每分钟 96 拍）。
// 地方特色第二阶段重编：由真正的甘美兰奏（原来是木琴、钢片琴、竖琴与木笛“模仿”甘美兰）——旋律、段落与曲式不变：
// - 萨龙奏一拍一个音的骨干旋律（balungan），斯连特姆低八度跟着，像甘美兰的地板；
// - 两架博南在高处咬合（kotekan：各奏一半的十六分音符，合起来是连续的一串）；B 段换成根德尔两手奏流动的一串；
// - 克农落在每小节第四拍、肯普尔落在第二拍，大锣在每个循环（四小节）的最后一拍收；肯当鼓轻轻带着拍子；
// - 雷巴布奏开头的起帆动机（B → E → B），像甘美兰的“引子”（buka）由雷巴布起，大锣一响全体进来；
// - 苏灵笛（原来的木笛）在上面拉长音唱，B 段的旋律给雷巴布、第二遍给苏灵笛。
// 甘美兰没有西洋的和声：原来的 Em、Cmaj7 和弦去掉，只剩很轻的 E–B 空五度持续音托底。
// 与经典世界的《信风群岛》（F 大调五声 6/8、鼻笛与四弦小吉他）不同：这里是带半音的五声、4/4 的锣的周期与咬合的十六分音符。
import type { TrackDef } from "../score";
import { kotekan, punctuate, woven, type Ladder } from "./weave";

/** 音阶（从低到高）：E F G B C，再高一个八度（与港口曲《胡椒与肉豆蔻的码头》同一组音）。 */
const PELOG: Ladder = { notes: ["E", "F", "G", "B", "c", "e", "f", "g", "b", "c'"] };

/** A 段的骨干旋律（每拍一个音；“B4”“E8”这种长音在锣的标点与咬合里按拍重复）。 */
const BAL_A = ["E", "F", "G", "B", "c", "B", "G", "F", "E", "G", "B", "c", "B", "B", "G", "G", "c", "B", "c", "e", "e", "f", "e", "c", "B", "G", "F", "G", "E", "E", "E", "E"];
/** B 段的骨干旋律。 */
const BAL_B = ["c", "e", "c", "B", "G", "B", "G", "F", "E", "F", "G", "B", "G", "G", "E", "E", "c", "B", "G", "B", "c", "c", "B", "B", "G", "F", "E", "F", "E", "E", "E", "E"];

const KA = kotekan(BAL_A, PELOG);
const KB = kotekan(BAL_B, PELOG);

export const SEA_NUSANTARA: TrackDef = {
  id: "sea_nusantara",
  title: { zh: "丁香群岛的铜锣", en: "Gongs of the Clove Islands" },
  qpm: 96,
  meter: [4, 4],
  key: "E phrygian",
  level: 1.2,
  voices: {
    saron: { inst: "saron", gain: 0.4, pan: 0.1, reverb: 0.3 },
    slenthem: { inst: "slenthem", gain: 0.34, pan: -0.06, reverb: 0.36 },
    bonang1: { inst: "bonang", gain: 0.2, pan: -0.3, reverb: 0.32 },
    bonang2: { inst: "bonang", gain: 0.2, pan: 0.3, reverb: 0.32 },
    gender: { inst: "gender", gain: 0.36, pan: 0.2, reverb: 0.38 },
    kenong: { inst: "kenong", gain: 0.32, pan: 0.22, reverb: 0.42 },
    kempul: { inst: "kempul", gain: 0.34, pan: -0.16, reverb: 0.44 },
    gong: { inst: "gong_ageng", gain: 0.58, pan: 0.02, reverb: 0.55 },
    suling: { inst: "suling", gain: 0.46, pan: -0.12, reverb: 0.44 },
    rebab: { inst: "rebab", gain: 0.44, pan: 0.16, reverb: 0.38 },
    kendang: {
      inst: "perc",
      gain: 0.26,
      pan: 0.12,
      reverb: 0.24,
      pattern: {
        a: { kind: "drum", steps: "D..kt.D.D.k.tDtU", hits: { D: ["kendang_dhang", 0.7], U: ["kendang_dhung", 0.7], k: ["kendang_tak", 0.5], t: ["kendang_tung", 0.55] } },
        b: { kind: "drum", steps: "D.ktD.tkD.kt.tDU", hits: { D: ["kendang_dhang", 0.75], U: ["kendang_dhung", 0.75], k: ["kendang_ket", 0.5], t: ["kendang_tung", 0.6] } },
      },
    },
    // 衬底（合成）：很轻的 E–B 空五度
    pad: { inst: "drone", gain: 0.1, pan: -0.14, reverb: 0.46, pattern: { kind: "drone", notes: [40, 47] } },
  },
  sections: {
    intro: {
      bars: 2,
      lines: {
        // 起帆动机（B → E → B），引子的最后大锣一响
        motif: "z6 B,3/2 E/2 | !vib!B8",
        gong: "z8 | z6 E,,,2",
      },
    },
    A: {
      bars: 8,
      lines: {
        // 一拍一个音的骨干旋律（与原来同一条）
        bal: "E2 F2 G2 B2 | c2 B2 G2 F2 | E2 G2 B2 c2 | B4 G4 | c2 B2 c2 e2 | e2 f2 e2 c2 | B2 G2 F2 G2 | E8",
        suling: "!vib!B6 c2 | {f}e4 B4 | !vib!G6 F2 | !vib!E8 | z4 e3 f | !bend!g4 e4 | {f}e4 c2 B2 | !vib!B8",
        polos: KA.polos,
        sangsih: KA.sangsih,
        kenong: punctuate(BAL_A, 4),
        kempul: punctuate(BAL_A, 2, ",,", [0, 1, 2, 4, 5, 6]),
        gong: punctuate(BAL_A, 4, ",,,", [3, 7]),
      },
    },
    B: {
      bars: 8,
      lines: {
        bal2: "c2 e2 c2 B2 | G2 B2 G2 F2 | E2 F2 G2 B2 | G4 E4 | c2 B2 G2 B2 | c4 B4 | G2 F2 E2 F2 | E8",
        bmel: "!vib!e6 g2 | B4 !bend!e4 | !vib!c6 B2 | !vib!G8 | e2 g2 b2 g2 | !vib!e4 c4 | B6 G2 | !vib!E8",
        flow: woven(BAL_B, PELOG),
        polos: KB.polos,
        sangsih: KB.sangsih,
        kenong: punctuate(BAL_B, 4),
        kempul: punctuate(BAL_B, 2, ",,", [0, 1, 2, 4, 5, 6]),
        gong: punctuate(BAL_B, 4, ",,,", [3, 7]),
      },
    },
    outro: {
      bars: 2,
      lines: { tag: "!vib!B4 G4 | !vib!E8", gong: "z8 | E,,,8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "motif:rebab gong:gong pad", dyn: 0.54, to: 0.6 },
      { s: "A", play: "bal:saron bal:slenthem-12 kenong:kenong kempul:kempul gong:gong kendang pad", dyn: 0.62 },
      { s: "A", play: "bal:saron bal:slenthem-12 polos:bonang1+12 sangsih:bonang2+12 suling:suling kenong:kenong kempul:kempul gong:gong kendang pad", dyn: 0.66 },
      { s: "B", play: "bal2:saron bal2:slenthem-12 flow:gender bmel:rebab kenong:kenong kempul:kempul gong:gong kendang.b pad", dyn: 0.64 },
      { s: "A", play: "bal:saron bal:slenthem-12 polos:bonang1+12 sangsih:bonang2+12 suling:suling kenong:kenong kempul:kempul gong:gong kendang.b pad", dyn: 0.7 },
      { s: "outro", play: "tag:suling gong:gong pad", dyn: 0.58, to: 0.38, rit: 0.85 },
    ],
    [
      { s: "intro", play: "motif:suling gong:gong pad", dyn: 0.52, to: 0.58 },
      { s: "A", play: "bal:saron bal:slenthem-12 polos:bonang1+12 sangsih:bonang2+12 kenong:kenong kempul:kempul gong:gong kendang pad", dyn: 0.62 },
      { s: "B", play: "bal2:saron bal2:slenthem-12 flow:gender bmel:rebab kenong:kenong kempul:kempul gong:gong kendang pad", dyn: 0.64 },
      { s: "B", play: "bal2:saron bal2:slenthem-12 polos:bonang1+12 sangsih:bonang2+12 bmel:suling kenong:kenong kempul:kempul gong:gong kendang.b pad", dyn: 0.68 },
      { s: "A", play: "bal:saron bal:slenthem-12 polos:bonang1+12 sangsih:bonang2+12 suling:suling kenong:kenong kempul:kempul gong:gong kendang.b pad", dyn: 0.7 },
      { s: "outro", play: "tag:suling gong:gong pad", dyn: 0.56, to: 0.36, rit: 0.85 },
    ],
  ],
  rest: [25, 45],
};
