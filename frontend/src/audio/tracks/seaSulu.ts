// 《苏禄海的锣》：菲律宾南部的海（苏禄海、西里伯斯海、棉兰老与米沙鄢之间——苏禄与马京达瑙的船在岛与岛之间往来）。
// 地方特色第二阶段新写的航海曲：库林唐锣乐领奏（不是经典世界的《信风群岛》——那首是经典世界“群岛”地域的航海曲，逐采样不变）。
// E 上的五声（E G A B D），库林唐只用《霍洛的锣》那一套八只排锣（D E G A B d e g），慢的 4/4（每分钟 88 拍），航行的律动由两只阿贡大锣给出：低的“嗡——”三拍、高的一拍，一长一短像船在浪上起伏；
// 达巴坎鼓与巴本迪尔平顶锣只轻轻地点。
// - 引子：苏灵笛吹起全作的起帆动机（B → E → B），阿贡一响；
// - A：库林唐慢慢地绕（八分音符为主，留着空）；
// - A′：库林唐的变奏（十六分音符），苏灵笛在上面拉长音，甘丁甘（四只吊锣，与《霍洛的锣》同一套）在低处应；
// - B：船形琴（库迪亚皮：旋律与空弦 E 交替）与苏灵笛，阿贡只剩低的一只——夜里的海；
// - A″：全体回来；尾声苏灵笛一句，阿贡收。
// 锣乐没有和弦：只有很轻的 E–B 空五度持续音托底。
import type { TrackDef } from "../score";

/** 阿贡：低的（E）三拍、高的（B）一拍。 */
const AGUNG = Array.from({ length: 8 }, () => "E,,3 B,, E,,3 B,,").join(" | ");

export const SEA_SULU: TrackDef = {
  id: "sea_sulu",
  title: { zh: "苏禄海的锣", en: "Gongs of the Sulu Sea" },
  qpm: 88,
  meter: [4, 4],
  key: "E minor",
  level: 1.45,
  voices: {
    kul: { inst: "kulintang", gain: 0.42, pan: -0.1, reverb: 0.4 },
    agung: { inst: "agung", gain: 0.5, pan: 0.1, reverb: 0.5 },
    gand: { inst: "gandingan", gain: 0.4, pan: -0.22, reverb: 0.42 },
    kud: { inst: "kudyapi", gain: 0.5, pan: -0.14, reverb: 0.4 },
    suling: { inst: "suling", gain: 0.46, pan: 0.16, reverb: 0.48 },
    dabakan: { inst: "perc", gain: 0.2, pan: -0.3, reverb: 0.3, pattern: { kind: "drum", steps: "D..dr.D.", hits: { D: ["dabakan", 0.7], d: ["dabakan", 0.45], r: ["dabakan_rim", 0.5] } } },
    babendil: { inst: "perc", gain: 0.14, pan: 0.34, reverb: 0.32, pattern: { kind: "drum", steps: "b...m.b.", hits: { b: ["babendil", 0.65], m: ["babendil_mute", 0.55] } } },
    // 衬底（合成）：很轻的 E–B 空五度
    pad: { inst: "drone", gain: 0.1, pan: -0.14, reverb: 0.5, pattern: { kind: "drone", notes: [40, 47] } },
  },
  sections: {
    intro: {
      bars: 2,
      lines: {
        // 起帆动机（B → E → B）
        motif: "z6 B,3/2 E/2 | !vib!B8",
        ag: "E,,8 | z4 B,,4",
      },
    },
    A: {
      bars: 8,
      lines: {
        kul: "E G A B d2 B A | B2 A/2B/2A/2G/2 E4 | G A B d e2 d B | d/2e/2d/2B/2 A2 B4 | e2 d B d e g e | d/2e/2d/2B/2 A B G2 E2 | G A B A G E D E | G/2A/2G/2E/2 D2 E4",
        ag: AGUNG,
      },
    },
    A2: {
      bars: 8,
      lines: {
        kul:
          "E/2G/2A/2B/2 d2 B/2d/2B/2A/2 G2 | A/2B/2A/2G/2 E2 G A B2 | d/2e/2g/2e/2 d2 B/2A/2B/2d/2 e2 | g/2e/2d/2B/2 d2 B4 | " +
          "e/2g/2e/2g/2 e2 d/2e/2d/2B/2 A2 |B/2d/2B/2A/2 G2 A/2G/2E/2G/2 A2 | G/2A/2B/2d/2 B/2A/2G/2A/2 G/2E/2D/2E/2 G2 | E/2G/2A/2G/2 E2 E4",
        fl: "!vib!B6 d2 | !bend!e4 B4 | !vib!A6 G2 | !vib!B8 | z4 e3 g | !bend!a4 g2 e2 | !vib!d6 B2 | !vib!E8",
        // 甘丁甘一套只有四只吊锣：用《霍洛的锣》那一套（G, A, B, D），句尾落在 B（与 E–B 的空五度相合）
        gand: "B,2 z G, A,2 B,2 | B, z A, G, B,4 | G,2 z A, B,2 D2 | D z B, A, B,4 | D2 z B, A,2 D2 | D z B, A, G,2 B,2 | G, A, B, A, G,2 A,2 | B,4 z4",
        ag: AGUNG,
      },
    },
    B: {
      bars: 8,
      lines: {
        // 船形琴：旋律与空弦（E）交替
        kud: "E, B E, A E, G E2 | E, A E, B !bend!d2 B A | E, G E, A E, B d2 | !vib!B4 A G E2 | E, d E, B E, A G2 | E, E E, G !bend!A2 G E | E, D E, E G A B2 | !vib!A4 G E2 z",
        fl: "z8 | z4 !bend!B2 A2 | !vib!G6 E2 | z8 | z4 d2 !bend!e2 | !vib!d6 B2 | A2 G2 E2 D2 | !vib!E6 z2",
        ag: "E,,4 z4 | E,,4 z4 | E,,4 z4 | E,,4 z4 | E,,4 z4 | E,,4 z4 | E,,4 z4 | E,,4 z4",
      },
    },
    outro: {
      bars: 2,
      lines: { tag: "!vib!B4 A2 G2 | !vib!E8", ag: "z8 | E,,8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "motif:suling ag:agung pad", dyn: 0.54, to: 0.6 },
      { s: "A", play: "kul:kul ag:agung dabakan babendil pad", dyn: 0.62 },
      { s: "A2", play: "kul:kul fl:suling gand:gand ag:agung dabakan babendil pad", dyn: 0.66 },
      { s: "B", play: "kud:kud fl:suling+12 ag:agung pad", dyn: 0.56 },
      { s: "A2", play: "kul:kul fl:suling gand:gand ag:agung dabakan babendil pad", dyn: 0.68 },
      { s: "outro", play: "tag:suling ag:agung pad", dyn: 0.58, to: 0.38, rit: 0.85 },
    ],
    [
      { s: "intro", play: "motif:suling ag:agung pad", dyn: 0.52, to: 0.58 },
      { s: "A", play: "kul:kul ag:agung dabakan babendil pad", dyn: 0.62 },
      { s: "B", play: "kud:kud fl:suling+12 ag:agung pad", dyn: 0.56 },
      { s: "A2", play: "kul:kul fl:suling gand:gand ag:agung dabakan babendil pad", dyn: 0.68 },
      { s: "outro", play: "tag:suling ag:agung pad", dyn: 0.56, to: 0.36, rit: 0.85 },
    ],
  ],
  rest: [25, 45],
};
