// 《珍宝船队》：加勒比海与墨西哥湾（哈瓦那、韦拉克鲁斯、卡塔赫纳、波托韦洛之间的“西班牙大陆沿岸”）——每年两支船队把白银运回塞维利亚，
// 码头上是西班牙的琴、非洲的鼓点与岛上的沙槌。与《尤卡坦的信风》在同一片海轮着放（那一首是岛民与玛雅人的笛与木鼓）。
// 第九批 A01（2026-11-11）新写，旋律原创。A 多利亚（D 大三和弦里的升 F 是亮的那一下），6/8 拍（每分钟 112 拍），
// 6/8 与 3/4 叠着走（sesquiáltera：扫弦数两大拍，旋律有的小节数三小拍）——后来新西班牙沿岸的“松”就是从这种节拍里长出来的：
// - 引子：维韦拉琴扫弦、沙槌与刮瓜，奇里米亚（殖民地教堂与节庆里的木管）在低处吹一句；
// - A：肖姆管领奏；A′：把句子唱成三个四分音符一小节的宽步子，奇里米亚低八度跟着；
// - B：转到 C 大调一侧，中音竖笛与维奥尔琴隔着三度、六度唱二重（港口集市的热闹）；
// - 最后一遍 A 全体。竖琴的分解和弦（殖民地的竖琴）与弦乐、拨奏低音只做衬底（管弦版换成真的竖琴与弦乐）。
import type { TrackDef } from "../score";

export const SEA_TREASURE: TrackDef = {
  id: "sea_treasure",
  title: { zh: "珍宝船队" },
  qpm: 112,
  meter: [6, 8],
  key: "A dorian",
  voices: {
    shawm: { inst: "shawm", gain: 0.54, pan: -0.08, reverb: 0.34 },
    chir: { inst: "chirimia", gain: 0.46, pan: 0.12, reverb: 0.34 },
    reca: { inst: "rec_alto", gain: 0.48, pan: 0.1, reverb: 0.32 },
    gamba: { inst: "gamba", gain: 0.52, pan: -0.14, reverb: 0.3 },
    vstrum: {
      inst: "vihuela",
      gain: 0.24,
      pan: 0.3,
      reverb: 0.22,
      pattern: {
        a: { kind: "strum", low: 40, high: 64, steps: "D . d U d u" },
        c: { kind: "strum", low: 40, high: 64, steps: "D . . D . ." },
      },
    },
    mara: { inst: "perc", gain: 0.24, pan: 0.24, reverb: 0.22, pattern: { kind: "drum", steps: "m.mM.m", hits: { M: ["maraca_lo", 0.44], m: ["maraca_hi", 0.3] } } },
    guiro: { inst: "perc", gain: 0.22, pan: -0.24, reverb: 0.22, pattern: { kind: "drum", steps: "G..g.g", hits: { G: ["guiro_long", 0.44], g: ["guiro_short", 0.3] } } },
    tamb: { inst: "perc", gain: 0.3, pan: 0.06, reverb: 0.24, pattern: { kind: "drum", steps: "T..t.tT.tT.t", hits: { T: ["tambori", 0.56], t: ["tambori_soft", 0.36] } } },
    // 衬底（合成）
    hp: { inst: "harp", gain: 0.24, pan: -0.34, reverb: 0.32, pattern: { kind: "arp", low: 45, steps: "1 5 8 10 8 5", ring: 2 } },
    pad: { inst: "strings", gain: 0.14, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 55, high: 72, size: 3 } },
    pz: { inst: "pizz", gain: 0.18, pan: 0.05, reverb: 0.16, pattern: { kind: "arp", low: 33, steps: "1 . . 5 . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "Am | D | Am | E",
      lines: { call: "z6 | z6 | E3 A3 | ^G6" },
    },
    A: {
      bars: 8,
      chords: "Am | D | Am | E | Am | D | G*3 E*3 | Am",
      lines: {
        mel: "A2 c e2 a | f2 d A2 d | c2 e a2 e | ^g3 e3 | a2 e c2 e | d2 f a2 f | g2 d ^g2 e | a6",
      },
    },
    A2: {
      bars: 8,
      chords: "Am | Em | D | E | C | G | E | Am",
      lines: {
        // 三个四分音符一小节（sesquiáltera）
        mel2: "e2 c2 A2 | B2 e2 g2 | f2 d a2 f | e2 ^g2 e2 | c2 g2 e2 | B2 d g2 d | ^g2 e2 B2 | A6",
      },
    },
    B: {
      bars: 8,
      chords: "C | G | Am | E | C | G | Am*3 E*3 | Am",
      lines: {
        bmel: "g3 e2 c | d3 B2 d | c3 e2 a | b3 ^g2 e | c'3 g2 e | b3 g2 d | c2 e ^g2 b | a6",
        b2: "e3 c2 G | B3 G2 B | A3 c2 e | e3 e2 B | e3 e2 c | d3 B2 G | A2 c e2 ^g | e6",
      },
    },
    outro: {
      bars: 4,
      chords: "D | E | Am | Am",
      lines: { tag: "d2 f a2 f | ^g2 e2 B2 | A6 | z6" },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:chir vstrum.c mara guiro hp", dyn: 0.54, to: 0.62 },
      { s: "A", play: "mel:shawm vstrum.a mara guiro pz", dyn: 0.66 },
      { s: "A2", play: "mel2:shawm mel2:chir-12 vstrum.a mara guiro tamb hp pz", dyn: 0.68 },
      { s: "B", play: "bmel:reca b2:gamba vstrum.c mara hp pad pz", dyn: 0.66, to: 0.7 },
      { s: "A", play: "mel:shawm mel:reca vstrum.a mara guiro tamb hp pad pz", dyn: 0.74 },
      { s: "A2", play: "mel2:shawm mel2:chir-12 mel2:gamba vstrum.a mara guiro tamb hp pad pz", dyn: 0.74 },
      { s: "outro", play: "tag:shawm vstrum.c mara hp pad", dyn: 0.64, to: 0.44, rit: 0.84 },
    ],
    [
      { s: "intro", play: "call:chir vstrum.c mara hp", dyn: 0.54, to: 0.6 },
      { s: "A", play: "mel:reca vstrum.a mara guiro pz", dyn: 0.64 },
      { s: "B", play: "bmel:reca b2:gamba vstrum.c mara hp pad pz", dyn: 0.66 },
      { s: "A2", play: "mel2:shawm mel2:chir-12 vstrum.a mara guiro tamb hp pz", dyn: 0.7 },
      { s: "B", play: "bmel:reca b2:shawm vstrum.a mara guiro tamb hp pad pz", dyn: 0.72 },
      { s: "A", play: "mel:shawm mel:reca vstrum.a mara guiro tamb hp pad pz", dyn: 0.74 },
      { s: "outro", play: "tag:shawm vstrum.c mara hp pad", dyn: 0.64, to: 0.44, rit: 0.84 },
    ],
  ],
  rest: [25, 45],
};
