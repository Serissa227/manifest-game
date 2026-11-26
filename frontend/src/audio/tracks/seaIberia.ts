// 《圣文森特角的帆》：伊比利亚与大西洋沿岸（里斯本、塞维利亚、加的斯外海，萨格里什与圣文森特角——欧洲西南角，出大西洋的门）。
// A 小调，6/8 拍（每分钟 108 拍），低音沿着“安达卢西亚终止”一级级往下走（A 小 → G → F → E 大），E 大三和弦的升 G 是南方的颜色；
// 有的小节把 6/8 唱成 3/4（三个四分音符：伊比利亚的“六三交替”），像船头一下下切开浪。
// 第九批配乐·地方特色第二阶段重编：伊比利亚的乐器领奏，旋律与和声不变（原来借提琴、竖笛、圆号、吉他与爱尔兰手鼓的音色都换掉了）：
// - 开头萨克布在低处远远吹起全作的起帆动机（E → A → E，移到 A 小调上）；
// - A 段短号领奏那段一路往下的句子，维韦拉琴扫弦（rasgueado），巴洪管走低音，响板与阿杜菲方鼓推着；
//   再来时维奥尔琴唱带倚音的变奏，高音竖笛高八度跟着；
// - B 段转到 C 大调一侧，是出了海角之后的开阔大西洋：短号拉宽的长线，萨克布低八度跟着（塞维利亚大教堂的“短号与萨克布”）；
// - 最后一遍 A 段由肖姆管领奏（城门与港口的户外乐队），收尾是维奥尔琴。
// 弦乐群与拨奏低音只做极轻的衬底（管弦版换成真的弦乐）。
import type { TrackDef } from "../score";

export const SEA_IBERIA: TrackDef = {
  id: "sea_iberia",
  title: { zh: "圣文森特角的帆", en: "Sails off Cape St. Vincent" },
  qpm: 108,
  meter: [6, 8],
  key: "A minor",
  level: 1.17,
  voices: {
    cornett: { inst: "cornett", gain: 0.56, pan: -0.16, reverb: 0.32 },
    gamba: { inst: "gamba", gain: 0.56, pan: -0.1, reverb: 0.3 },
    recs: { inst: "rec_soprano", gain: 0.36, pan: 0.12, reverb: 0.32 },
    reca: { inst: "rec_alto", gain: 0.46, pan: 0.08, reverb: 0.32 },
    shawm: { inst: "shawm", gain: 0.6, pan: -0.06, reverb: 0.34 },
    sackbut: { inst: "sackbut", gain: 0.46, pan: -0.3, reverb: 0.38 },
    vstrum: {
      inst: "vihuela",
      gain: 0.22,
      pan: 0.3,
      reverb: 0.22,
      pattern: {
        a: { kind: "strum", low: 40, high: 64, steps: "D . d . U u" },
        c: { kind: "strum", low: 40, high: 64, steps: "D . . D . ." },
      },
    },
    bajon: { inst: "bajon", gain: 0.48, pan: 0.06, reverb: 0.2, pattern: { kind: "arp", low: 38, steps: "1 . . 5, . .", ring: 2 } },
    cast: { inst: "perc", gain: 0.45, pan: 0.24, reverb: 0.2, pattern: { kind: "drum", steps: "C.cc.c", hits: { C: ["castanet_lo", 0.4], c: ["castanet", 0.26] } } },
    adufe: {
      inst: "perc",
      gain: 0.34,
      pan: 0.08,
      reverb: 0.22,
      pattern: {
        a: { kind: "drum", steps: "A..T.t", hits: { A: ["adufe", 0.58], T: ["adufe", 0.38], t: ["adufe_tek", 0.3] } },
        b: { kind: "drum", steps: "A.tA.t A.tAtt", hits: { A: ["adufe", 0.6], t: ["adufe_tek", 0.32] } },
      },
    },
    // 衬底（合成）：极轻的弦乐长音与拨奏低音
    pad: { inst: "strings", gain: 0.16, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 55, high: 72, size: 3 } },
    pz: { inst: "pizz", gain: 0.18, pan: 0.05, reverb: 0.16, pattern: { kind: "arp", low: 36, steps: "1 . . 5, . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "Am | G | Am | E",
      // 起帆动机（E → A → E），萨克布在低处远远地吹
      lines: { motif: "z6 | z4 E,3/2 A,/2 | E6 | z6" },
    },
    A: {
      bars: 8,
      // 第 7 小节前半 F、后半 E，旋律三个四分音符（六三交替）
      chords: "Am | G | F | E | Am | G | F*3 E*3 | Am",
      lines: {
        mel: "A2 c e2 a | g3 f e d | f3 e d c | B3 ^G3 | A2 c e2 a | b3 a g f | a2 f2 ^g2 | a6",
        mel2: "A2 c e2 a | {a}g3 f e d | f3 e d c | B2 c B ^G2 | A2 c e2 a | b2 g2 e2 | a2 f2 ^g2 | a6",
      },
    },
    B: {
      bars: 8,
      chords: "C | G | Am | E | F | C | Dm | E",
      lines: {
        // 出了海角：一条宽的长线
        bmel: "e3 g3 | d3 B3 | c3 e2 d | B6 | A3 c3 | G3 e3 | f3 d2 e | ^g6",
      },
    },
    outro: {
      bars: 4,
      chords: "F | E | Am | Am",
      lines: { tag: "a3 f3 | e3 ^G3 | A6 | z6" },
    },
  },
  forms: [
    [
      { s: "intro", play: "motif:sackbut vstrum.c bajon cast adufe", dyn: 0.55, to: 0.64 },
      { s: "A", play: "mel:cornett vstrum bajon cast adufe", dyn: 0.66 },
      { s: "A", play: "mel2:gamba mel2:recs+12 vstrum bajon cast adufe", dyn: 0.68 },
      { s: "B", play: "bmel:cornett bmel:sackbut-12 pad vstrum.c bajon adufe pz", dyn: 0.7, to: 0.74 },
      { s: "A", play: "mel:shawm vstrum bajon cast adufe.b pad pz", dyn: 0.74 },
      { s: "outro", play: "tag:gamba vstrum.c bajon pad", dyn: 0.62, to: 0.42, rit: 0.82 },
    ],
    [
      { s: "intro", play: "motif:sackbut vstrum.c bajon", dyn: 0.52, to: 0.62 },
      { s: "A", play: "mel:reca vstrum bajon cast", dyn: 0.64 },
      { s: "B", play: "bmel:gamba pad vstrum.c bajon adufe pz", dyn: 0.68, to: 0.72 },
      { s: "B", play: "bmel:cornett bmel:sackbut-12 pad vstrum.c bajon cast adufe pz", dyn: 0.72, to: 0.76 },
      { s: "A", play: "mel2:gamba mel2:recs+12 vstrum bajon cast adufe.b pad pz", dyn: 0.74 },
      { s: "outro", play: "tag:reca vstrum.c bajon pad", dyn: 0.6, to: 0.4, rit: 0.82 },
    ],
  ],
  rest: [25, 45],
};
