// 《驼铃与海风》：沙漠海岸与南方海路（巴布拉姆海、哈拉海、贾马尔海与卡迪尔西南的南荒海）。
// D 上的希贾兹（降 E、升 F 之间的增二度），6/8 拍：达布卡鼓“咚 · 嗒 咚 卡 嗒”推着船走，低音拨奏落在第一、四拍；
// D 与 A 的持续音只在前奏与尾声（和弦都是 D）里响，中间换到 C 小调、G 小调、降 E 大调和弦时不留持续音，免得 D 与降 E 顶在一起。
// 乌德琴与奈伊笛轮流领奏，卡农琴（用筝的音色）弹分解和弦；开头奈伊笛吹起帆动机，
// 远处一串驼铃（岸上的商队）。与港口曲《香料之路》（巴亚提、四分之一音）不同，这里不用四分之一音，律动也是航海曲的 6/8。
// B 段升到高处、弦乐铺开，是离岸之后的开阔海面，最后一句顺着希贾兹音阶 A → G → 升 F → 降 E 落回 D。
import type { TrackDef } from "../score";

export const SEA_SOUTH: TrackDef = {
  id: "sea_south",
  title: { zh: "驼铃与海风", en: "Camel Bells on the Sea Wind" },
  qpm: 100,
  meter: [6, 8],
  key: "D hijaz",
  voices: {
    oud: { inst: "oud", gain: 0.72, pan: -0.15, reverb: 0.26 },
    ney: { inst: "ney", gain: 0.64, pan: 0.2, reverb: 0.36 },
    qanun: { inst: "zheng", gain: 0.22, pan: 0.35, reverb: 0.3, pattern: { kind: "arp", low: 50, steps: "1 5 8 5 12 8", ring: 2 } },
    drone: { inst: "drone", gain: 0.5, reverb: 0.25, pattern: { kind: "drone", notes: [38, 45] } },
    bass: { inst: "pizz", gain: 0.34, pan: 0.05, reverb: 0.15, pattern: { kind: "arp", low: 38, steps: "1 . . 5, . .", ring: 2 } },
    strings: { inst: "strings", gain: 0.46, pan: -0.25, reverb: 0.42, pattern: { kind: "pad", low: 55, high: 72, size: 3 } },
    darbuka: {
      inst: "perc",
      gain: 0.2,
      pan: 0.1,
      reverb: 0.2,
      pattern: { kind: "drum", steps: "D.TDkT", hits: { D: ["doum", 0.75], T: ["tek", 0.45], k: ["ka", 0.3] } },
    },
    riq: { inst: "perc", gain: 0.45, pan: -0.3, reverb: 0.2, pattern: { kind: "drum", steps: "..r..r", hits: { r: ["riq", 0.35] } } },
    bells: { inst: "bell", gain: 0.22, pan: 0.45, reverb: 0.5 },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "D | D | D | D",
      lines: {
        motif: "z6 | z4 A3/2 d/2 | a6 | z6",
        // 远处商队的驼铃
        bells: "z2 a' z2 f' | z2 a' z3 | z2 a' z2 f' | z6",
      },
    },
    A: {
      bars: 8,
      chords: "D | D | Cm | D | Gm | Eb | D | D",
      lines: {
        mel: "A3 A2 G | F3 E2 D | G3 E2 C | D6 | d3 c2 B | B3 G2 E | F2 G A2 c | A6",
      },
    },
    B: {
      bars: 8,
      chords: "Gm | Cm | D | D | Eb | Cm | D | D",
      lines: {
        mel: "d3 d2 c | c3 B2 A | A3 F2 A | d6 | e3 d2 c | G3 E2 G | A2 G F2 E | D6",
      },
    },
    outro: {
      bars: 4,
      chords: "D | D | D | D",
      lines: {
        tag: "A3 G2 F | F3 E2 D | F2 G A2 G | D6",
        bells: "z2 a' z2 f' | z6 | z2 a' z3 | z6",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "motif:ney bells:bells drone darbuka", dyn: 0.55, to: 0.64 },
      { s: "A", play: "mel:oud bass darbuka qanun", dyn: 0.66 },
      { s: "A", play: "mel:ney mel:oud-12 qanun bass darbuka riq", dyn: 0.68 },
      { s: "B", play: "mel:ney strings qanun bass darbuka riq", dyn: 0.68, to: 0.74 },
      { s: "B", play: "mel:oud mel:ney qanun strings bass darbuka riq", dyn: 0.74 },
      { s: "A", play: "mel:oud mel:ney qanun bass darbuka riq", dyn: 0.72 },
      { s: "outro", play: "tag:oud bells:bells drone bass", dyn: 0.6, to: 0.4, rit: 0.85 },
    ],
    [
      { s: "intro", play: "motif:ney drone", dyn: 0.52, to: 0.6 },
      { s: "A", play: "mel:ney qanun bass darbuka", dyn: 0.64 },
      { s: "A", play: "mel:oud qanun bass darbuka riq", dyn: 0.68 },
      { s: "B", play: "mel:oud strings bass darbuka", dyn: 0.66, to: 0.72 },
      { s: "B", play: "mel:ney mel:oud-12 qanun strings bass darbuka riq", dyn: 0.72 },
      { s: "A", play: "mel:oud mel:ney qanun bass darbuka riq", dyn: 0.72 },
      { s: "outro", play: "tag:ney bells:bells drone bass", dyn: 0.58, to: 0.38, rit: 0.85 },
    ],
  ],
  rest: [25, 45],
};
