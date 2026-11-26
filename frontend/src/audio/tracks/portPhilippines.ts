// 《霍洛的锣》：菲律宾南部的港口（苏禄的霍洛、马京达瑙的哥打巴托、吕宋的马尼拉湾）。地方特色第二阶段：库林唐锣乐（kulintang）领奏。
// 音阶：八只排锣（D E G A B d e g）上的五声，每套锣的调律不同，这里按十二平均律近似。
// 4/4（每分钟 116 拍），一种原创的节奏型（像马京达瑙的 sinulog 一类）：巴本迪尔的“叮 · 嗒叮”从头到尾不停，达巴坎鼓定下鼓型，
// 两只阿贡大锣一低一高咬合着走低音（低的落在第一、三拍，高的在拍后），甘丁甘“会说话的锣”跟着旋律的轮廓短促地应；
// 库林唐在上面即兴地绕：一个短动机反复、换一个音、往上走、落回 G。
// - 引子：库林唐一个人起句，达巴坎两下把大家带进来；
// - A：库林唐 + 阿贡 + 达巴坎 + 巴本迪尔；
// - A′：库林唐的变奏（更高、更密）；
// - B：夜里的马拉瑙船形琴（库迪亚皮：旋律与空弦 G 交替），苏灵笛在上面飘，阿贡只剩低的一只；
// - A″：全体回来，甘丁甘加入；尾声库林唐一句，阿贡收。
// 锣乐没有和弦：只有很轻的 G–D 空五度持续音托底。
import type { TrackDef } from "../score";

/** 库林唐的旋律（A 段）。 */
const KUL_A =
  "d/2B/2A/2B/2 d2 e/2d/2B/2A/2 G2 | A/2B/2d/2B/2 A/2G/2E/2G/2 A2 B2 | d/2B/2A/2B/2 d2 g/2e/2d/2e/2 g2 | e/2d/2B/2d/2 e/2d/2B/2A/2 B4 | " +
  "G/2A/2B/2A/2 G2 E/2G/2A/2G/2 E2 | D/2E/2G/2E/2 D2 E G A B | d/2e/2d/2B/2 A/2B/2A/2G/2 E/2G/2A/2B/2 d2 | B/2A/2G/2E/2 D2 G4";
/** 库林唐的变奏（A′ 段）：更高、更密。 */
const KUL_A2 =
  "g/2e/2d/2e/2 g2 e/2d/2B/2d/2 e2 | d/2B/2A/2B/2 d/2e/2d/2B/2 A2 G2 | B/2d/2e/2g/2 e/2d/2B/2d/2 e/2g/2e/2d/2 B2 | A/2B/2A/2G/2 E/2G/2A/2B/2 d4 | " +
  "d/2d/2B/2d/2 e2 d/2d/2B/2A/2 B2 | G/2A/2B/2d/2 B/2A/2G/2E/2 D2 E2 | G/2A/2B/2d/2 e/2g/2e/2d/2 B/2d/2B/2A/2 G2 | E/2G/2A/2B/2 A/2G/2E/2D/2 G4";
/** 阿贡：低的（D）落在第一、三拍，高的（G）在拍后。 */
const AGUNG = Array.from({ length: 8 }, () => "D,,2 G,, z D,,2 G,, z").join(" | ");
/** 甘丁甘：跟着旋律的轮廓，短促地“说”。 */
const GANDINGAN = "B,2 z B, A,2 G,2 | A, z A, B, G,2 z2 | B,2 z D A,2 B,2 | D2 z B, A,2 z2 | G, z A, B, G,2 z2 | G,2 z A, G,2 z2 | A, B, A, G, A,2 B,2 | G,4 z4";

export const PORT_PHILIPPINES: TrackDef = {
  id: "port_philippines",
  title: { zh: "霍洛的锣", en: "Gongs of Jolo" },
  qpm: 116,
  meter: [4, 4],
  key: "G major",
  voices: {
    kul: { inst: "kulintang", gain: 0.44, pan: -0.08, reverb: 0.32 },
    agung: { inst: "agung", gain: 0.5, pan: 0.12, reverb: 0.42 },
    gand: { inst: "gandingan", gain: 0.42, pan: -0.22, reverb: 0.36 },
    kud: { inst: "kudyapi", gain: 0.5, pan: -0.12, reverb: 0.34 },
    suling: { inst: "suling", gain: 0.4, pan: 0.18, reverb: 0.42 },
    babendil: {
      inst: "perc",
      gain: 0.18,
      pan: 0.32,
      reverb: 0.26,
      pattern: {
        a: { kind: "drum", steps: "b.mbb.mb", hits: { b: ["babendil", 0.7], m: ["babendil_mute", 0.6] } },
        coda: { kind: "drum", steps: "b.mbb.mbb.......", hits: { b: ["babendil", 0.75], m: ["babendil_mute", 0.65] } },
      },
    },
    dabakan: {
      inst: "perc",
      gain: 0.26,
      pan: -0.3,
      reverb: 0.26,
      pattern: {
        a: { kind: "drum", steps: "D.dDr.Dd", hits: { D: ["dabakan", 0.8], d: ["dabakan", 0.5], r: ["dabakan_rim", 0.6] } },
        b: { kind: "drum", steps: "D.dDr.DdD.dD.rDD", hits: { D: ["dabakan", 0.85], d: ["dabakan", 0.55], r: ["dabakan_rim", 0.65] } },
        intro: { kind: "drum", steps: "............D.DD", hits: { D: ["dabakan", 0.8] } },
        coda: { kind: "drum", steps: "D.D.DdDDD.......", hits: { D: ["dabakan", 0.85], d: ["dabakan", 0.55] } },
      },
    },
    // 衬底（合成）：很轻的 G–D 空五度
    pad: { inst: "drone", gain: 0.1, pan: -0.16, reverb: 0.46, pattern: { kind: "drone", notes: [43, 50] } },
  },
  sections: {
    intro: {
      bars: 2,
      lines: { kul: "d/2e/2g/2e/2 d/2B/2A/2B/2 d4 | B/2A/2G/2E/2 D2 z4" },
    },
    A: {
      bars: 8,
      lines: { kul: KUL_A, ag: AGUNG, gand: GANDINGAN },
    },
    A2: {
      bars: 8,
      lines: { kul: KUL_A2, ag: AGUNG, gand: GANDINGAN },
    },
    B: {
      bars: 8,
      lines: {
        // 船形琴：旋律与空弦（G）交替
        kud: "G, d G, B G, A G2 | G, B G, d !bend!e2 d B | G, A G, B G, d e2 | !vib!d4 B A G2 | G, e G, d G, B A2 | G, G G, A !bend!B2 A G | G, E G, G A B d2 | !vib!B4 A G2 z",
        fl: "z8 | z4 !bend!d2 B2 | !vib!A6 G2 | z8 | z4 e2 !bend!g2 | !vib!e6 d2 | B2 A2 G2 E2 | !vib!D6 z2",
        ag: "D,,4 z4 | D,,4 z4 | D,,4 z4 | D,,4 z4 | D,,4 z4 | D,,4 z4 | D,,4 z4 | D,,4 z4",
      },
    },
    coda: {
      bars: 2,
      lines: {
        kul: "d/2e/2d/2B/2 A/2B/2A/2G/2 E/2G/2A/2B/2 d2 | G4 z4",
        ag: "D,,2 G,,2 D,,2 G,,2 | D,,4 z4",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "kul:kul dabakan.intro pad", dyn: 0.66 },
      { s: "A", play: "kul:kul ag:agung dabakan babendil pad", dyn: 0.68 },
      { s: "A2", play: "kul:kul ag:agung dabakan.b babendil pad", dyn: 0.72 },
      { s: "B", play: "kud:kud fl:suling+12 ag:agung pad", dyn: 0.56, tempo: 0.88 },
      { s: "A", play: "kul:kul ag:agung gand:gand dabakan.b babendil pad", dyn: 0.74 },
      { s: "coda", play: "kul:kul ag:agung dabakan.coda babendil.coda pad", dyn: 0.76, rit: 0.9 },
    ],
    [
      { s: "A", play: "kul:kul ag:agung dabakan babendil pad", dyn: 0.68 },
      { s: "B", play: "kud:kud fl:suling+12 ag:agung pad", dyn: 0.56, tempo: 0.88 },
      { s: "A2", play: "kul:kul ag:agung gand:gand dabakan.b babendil pad", dyn: 0.74 },
      { s: "coda", play: "kul:kul ag:agung dabakan.coda babendil.coda pad", dyn: 0.76, rit: 0.9 },
    ],
  ],
  rest: [10, 18],
  level: 1.34,
};
