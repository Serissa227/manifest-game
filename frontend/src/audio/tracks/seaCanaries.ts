// 《加那利的顺风》：伊比利亚外海与大西洋群岛（比斯开、里斯本外海、阿尔沃兰海、马德拉与加那利、亚速尔）——
// 出了直布罗陀往西南，靠加那利洋流与东北信风一路顺下去。与《圣文森特角的帆》在同一片海轮着放。
// 第九批 A01（2026-11-11）新写，旋律原创。写法取自“加那利舞”（canario）：十六世纪从加那利群岛传到西班牙宫廷的快 6/8 舞曲，
// 附点的小跳步（附点八分 + 十六分 + 八分）、跺脚的重音，低音反复走一级 – 四级 – 一级 – 五级；有的小节把 6/8 唱成三个四分音符（六三交替）。
// D 大调，6/8 拍（每分钟 116 拍）：
// - 引子：维韦拉琴扫弦、阿杜菲方鼓，三孔笛在高处吹一句、它自己的塔博鼓跟着；
// - A：中音竖笛领奏那串小跳步；A′：肖姆管（再来时是短号）把它唱成六三交替的宽句子，扫弦照旧是 6/8，上下两层错开；
// - B：转到 B 小调一侧，维奥尔琴拉一段连贯的长句（出了港的长浪），再来时中音竖笛在上方三度、六度地托着；
// - 最后一遍 A 中音竖笛与短号齐奏，响板、方鼓全上；尾声六三交替收住。
// 弦乐群与拨奏低音只做极轻的衬底（管弦版换成真的弦乐）。
import type { TrackDef } from "../score";

export const SEA_CANARIES: TrackDef = {
  id: "sea_canaries",
  title: { zh: "加那利的顺风" },
  qpm: 116,
  meter: [6, 8],
  key: "D major",
  level: 1.16,
  voices: {
    reca: { inst: "rec_alto", gain: 0.5, pan: 0.08, reverb: 0.32 },
    shawm: { inst: "shawm", gain: 0.54, pan: -0.08, reverb: 0.34 },
    cornett: { inst: "cornett", gain: 0.52, pan: -0.16, reverb: 0.32 },
    gamba: { inst: "gamba", gain: 0.56, pan: -0.1, reverb: 0.3 },
    pipe: { inst: "pipe", gain: 0.3, pan: 0.22, reverb: 0.34 },
    vstrum: {
      inst: "vihuela",
      gain: 0.24,
      pan: 0.3,
      reverb: 0.22,
      pattern: {
        a: { kind: "strum", low: 38, high: 66, steps: "D . d D u ." },
        c: { kind: "strum", low: 38, high: 66, steps: "D . . D . ." },
      },
    },
    bajon: { inst: "bajon", gain: 0.46, pan: 0.06, reverb: 0.2, pattern: { kind: "arp", low: 38, steps: "1 . . 5, . .", ring: 2 } },
    cast: { inst: "perc", gain: 0.42, pan: 0.24, reverb: 0.2, pattern: { kind: "drum", steps: "C.cC.c", hits: { C: ["castanet_lo", 0.4], c: ["castanet", 0.26] } } },
    adufe: {
      inst: "perc",
      gain: 0.34,
      pan: 0.08,
      reverb: 0.22,
      pattern: {
        a: { kind: "drum", steps: "A..T.t", hits: { A: ["adufe", 0.58], T: ["adufe", 0.36], t: ["adufe_tek", 0.3] } },
        b: { kind: "drum", steps: "A.tA.t A.tAtt", hits: { A: ["adufe", 0.6], t: ["adufe_tek", 0.32] } },
      },
    },
    tabor: { inst: "perc", gain: 0.3, pan: 0.22, reverb: 0.24, pattern: { kind: "drum", steps: "T..t.t", hits: { T: ["tambori", 0.6], t: ["tambori_soft", 0.4] } } },
    // 衬底（合成）
    pad: { inst: "strings", gain: 0.15, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 57, high: 74, size: 3 } },
    pz: { inst: "pizz", gain: 0.18, pan: 0.05, reverb: 0.16, pattern: { kind: "arp", low: 38, steps: "1 . . 5, . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "D | G | D | A",
      lines: { call: "z6 | z6 | d'>e' d' a2 f | a6" },
    },
    A: {
      bars: 8,
      chords: "D | G | D | A | D | G | D*3 A*3 | D",
      lines: {
        // 加那利舞的小跳步
        mel: "d>e f a2 f | g>a b g2 d | f>g a f2 d | e3 c2 A | d>e f a2 f | b>a g d'2 b | a2 f e2 c | d6",
      },
    },
    A2: {
      bars: 8,
      chords: "D | G | D | A | G | D | A | D",
      lines: {
        // 六三交替：三个四分音符的小节与小跳步的小节隔着来
        mel2: "A2 d2 f2 | g2 d2 B2 | A>B c d2 f | e2 c2 A2 | B>c d g2 d | f2 d2 A2 | B>c d e2 c | d6",
      },
    },
    B: {
      bars: 8,
      chords: "Bm | Bm | G | A | Bm | Em | A | A",
      lines: {
        bmel: "F3 B3 | d3 c2 B | B3 G2 B | c3 A3 | d3 f3 | e3 g2 e | c3 e2 c | A2 B c3",
        // 中音竖笛在上方托着
        desc: "d6 | f6 | g6 | e6 | f6 | g6 | e6 | e6",
      },
    },
    outro: {
      bars: 4,
      chords: "G | D | A | D",
      lines: { tag: "b>a g d'2 b | a>g f d2 A | c2 e2 c2 | d6" },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:pipe vstrum.c bajon adufe tabor", dyn: 0.56, to: 0.64 },
      { s: "A", play: "mel:reca vstrum bajon cast adufe", dyn: 0.66 },
      { s: "A2", play: "mel2:shawm vstrum bajon cast adufe", dyn: 0.68 },
      { s: "B", play: "bmel:gamba pad vstrum.c bajon pz", dyn: 0.64, to: 0.68 },
      { s: "A2", play: "mel2:cornett vstrum bajon cast adufe.b pad pz", dyn: 0.7 },
      { s: "A", play: "mel:reca mel:cornett vstrum bajon cast adufe.b tabor pad pz", dyn: 0.74 },
      { s: "outro", play: "tag:reca vstrum.c bajon adufe pad", dyn: 0.64, to: 0.44, rit: 0.84 },
    ],
    [
      { s: "intro", play: "call:pipe vstrum.c bajon tabor", dyn: 0.54, to: 0.62 },
      { s: "A", play: "mel:cornett vstrum bajon cast", dyn: 0.64 },
      { s: "B", play: "bmel:gamba pad vstrum.c bajon pz", dyn: 0.64 },
      { s: "B", play: "bmel:gamba desc:reca pad vstrum.c bajon adufe pz", dyn: 0.66, to: 0.7 },
      { s: "A2", play: "mel2:shawm vstrum bajon cast adufe pad pz", dyn: 0.7 },
      { s: "A", play: "mel:reca mel:cornett vstrum bajon cast adufe.b tabor pad pz", dyn: 0.74 },
      { s: "outro", play: "tag:reca vstrum.c bajon adufe pad", dyn: 0.64, to: 0.44, rit: 0.84 },
    ],
  ],
  rest: [25, 45],
};
