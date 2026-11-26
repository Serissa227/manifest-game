// 《胡椒与肉豆蔻的码头》：马来与东南亚的港口（马六甲、万丹、亚齐、文莱……胡椒、丁香与肉豆蔻的码头）。
// 地方特色第一阶段重编：甘美兰领奏（复古合成版的衬底只有很轻的合成持续音）。
// 佩洛格一类的五声（E F G B C，带半音；与航海曲《丁香群岛的铜锣》同一组音），4/4（每分钟 92 拍），写成爪哇甘美兰的一首小曲（兰查兰一类）：
// - 引子（buka）：雷巴布一句，大锣“嗡——”一响，整个乐队进来；
// - A：萨龙奏骨干旋律（balungan，一拍一个音），两架博南在高八度咬合（kotekan：各奏一半的十六分音符，合起来是流动的一串），
//   克农落在每小节第四拍、肯普尔落在第二拍，大锣在每四小节（一个循环）的最后一拍收；肯当鼓领着；
// - A′：苏灵笛在上面自由地飘；
// - B：换一段骨干旋律，根德尔两手奏流动的一串，雷巴布唱，博南停下，安静一点；
// - A″：全体回来，最后一个循环慢下来（suwuk），落在大锣上。
// 甘美兰没有西洋的和声：音阶、音色（非谐波的分音、成对乐器的“翁巴克”拍音）与锣的循环就是它的“和声”。
import type { TrackDef } from "../score";
import { beats, kotekan, punctuate, woven, type Ladder } from "./weave";

/** 音阶（从低到高）：E F G B C，再高一个八度。 */
const PELOG: Ladder = { notes: ["E", "F", "G", "B", "c", "e", "f", "g", "b", "c'"] };

/** 第一段骨干旋律：两个循环（各十六拍），落在 G 与 E 上。 */
const BAL_A = ["B", "c", "B", "G", "F", "G", "B", "c", "e", "c", "B", "G", "F", "E", "F", "G", "c", "B", "G", "F", "E", "F", "G", "B", "c", "e", "c", "B", "F", "G", "F", "E"];
/** 第二段骨干旋律。 */
const BAL_B = ["G", "B", "c", "B", "G", "F", "E", "F", "G", "B", "G", "F", "E", "F", "E", "G", "e", "f", "e", "c", "B", "c", "B", "G", "F", "G", "B", "c", "B", "G", "F", "E"];

const KA = kotekan(BAL_A, PELOG);

export const PORT_MALAY: TrackDef = {
  id: "port_malay",
  title: { zh: "胡椒与肉豆蔻的码头", en: "Pepper and Nutmeg Quay" },
  qpm: 92,
  meter: [4, 4],
  key: "E phrygian",
  voices: {
    saron: { inst: "saron", gain: 0.42, pan: -0.06, reverb: 0.3 },
    bonang1: { inst: "bonang", gain: 0.22, pan: -0.28, reverb: 0.3 },
    bonang2: { inst: "bonang", gain: 0.22, pan: 0.28, reverb: 0.3 },
    gender: { inst: "gender", gain: 0.36, pan: 0.18, reverb: 0.36 },
    kenong: { inst: "kenong", gain: 0.34, pan: 0.2, reverb: 0.4 },
    kempul: { inst: "kempul", gain: 0.36, pan: -0.14, reverb: 0.42 },
    gong: { inst: "gong_ageng", gain: 0.6, pan: 0, reverb: 0.5 },
    suling: { inst: "suling", gain: 0.46, pan: 0.12, reverb: 0.42 },
    rebab: { inst: "rebab", gain: 0.46, pan: -0.18, reverb: 0.34 },
    kendang: {
      inst: "perc",
      gain: 0.3,
      pan: 0.06,
      reverb: 0.24,
      pattern: {
        a: { kind: "drum", steps: "D.k.t.D.D.k.t.D.D.ktk.tDD.k.tktU", hits: { D: ["kendang_dhang", 0.75], U: ["kendang_dhung", 0.75], k: ["kendang_tak", 0.55], t: ["kendang_tung", 0.6] } },
        b: { kind: "drum", steps: "D...t...D...t.k.D...t...D.k.t.tU", hits: { D: ["kendang_dhang", 0.6], U: ["kendang_dhung", 0.6], k: ["kendang_ket", 0.45], t: ["kendang_tung", 0.5] } },
      },
    },
    // 衬底（合成）：很轻的 E–B 持续音
    pad: { inst: "drone", gain: 0.1, pan: -0.16, reverb: 0.46, pattern: { kind: "drone", notes: [40, 47] } },
  },
  sections: {
    buka: {
      bars: 2,
      lines: {
        call: "B2 !bend!c2 B G F E | !vib!G6 z2",
        gong: "z8 | z6 G,,,2",
      },
    },
    A: {
      bars: 8,
      lines: {
        bal: beats(BAL_A),
        polos: KA.polos,
        sangsih: KA.sangsih,
        kenong: punctuate(BAL_A, 4),
        kempul: punctuate(BAL_A, 2, ",,", [0, 1, 2, 4, 5, 6]),
        gong: punctuate(BAL_A, 4, ",,,", [3, 7]),
        float: "z8 | !bend!e4 {f}e2 c2 | B6 z2 | z4 G2 B2 | !vib!c6 B G | F4 z4 | e2 f2 !bend!e4 | !vib!E8",
      },
    },
    B: {
      bars: 8,
      lines: {
        bal: beats(BAL_B),
        flow: woven(BAL_B, PELOG),
        kenong: punctuate(BAL_B, 4),
        kempul: punctuate(BAL_B, 2, ",,", [0, 1, 2, 4, 5, 6]),
        gong: punctuate(BAL_B, 4, ",,,", [3, 7]),
        sing: "B4 !bend!c4 | B2 G F E4 | G2 B2 !bend!c2 B G | !vib!F6 E2 | !bend!e4 f2 e c | B6 G2 | F G B c !vib!B4 | G2 F2 !fall!E4",
      },
    },
  },
  forms: [
    [
      { s: "buka", play: "call:rebab gong:gong", dyn: 0.62 },
      { s: "A", play: "bal:saron polos:bonang1+12 sangsih:bonang2+12 kenong:kenong kempul:kempul gong:gong kendang.a pad", dyn: 0.66 },
      { s: "A", play: "bal:saron polos:bonang1+12 sangsih:bonang2+12 kenong:kenong kempul:kempul gong:gong float:suling kendang.a pad", dyn: 0.68 },
      { s: "B", play: "bal:saron flow:gender sing:rebab kenong:kenong kempul:kempul gong:gong kendang.b pad", dyn: 0.6 },
      { s: "A", play: "bal:saron polos:bonang1+12 sangsih:bonang2+12 kenong:kenong kempul:kempul gong:gong float:suling kendang.a pad", dyn: 0.68, rit: 0.85 },
    ],
    [
      { s: "A", play: "bal:saron polos:bonang1+12 sangsih:bonang2+12 kenong:kenong kempul:kempul gong:gong float:suling kendang.a pad", dyn: 0.66 },
      { s: "B", play: "bal:saron flow:gender sing:rebab kenong:kenong kempul:kempul gong:gong kendang.b pad", dyn: 0.6 },
      { s: "A", play: "bal:saron polos:bonang1+12 sangsih:bonang2+12 kenong:kenong kempul:kempul gong:gong kendang.a pad", dyn: 0.68, rit: 0.85 },
    ],
  ],
  rest: [10, 18],
  level: 1.35,
};
