// 《第勒尼安的夏夜》：地中海的西半边（第勒尼安海、利古里亚海、巴利阿里海、西西里海峡、爱奥尼亚海、亚得里亚海）——
// 夏夜没什么风，船慢慢地走，远处岸上有灯。与《亚得里亚的帆影》在同一片海轮着放。
// 第九批 A01（2026-11-11）新写，旋律原创。写成一首“西西里舞曲”式的慢 6/8（附点八分 + 十六分 + 八分的摇荡，南意大利牧歌的步子）：
// D 小调，每分钟 80 个四分音符——
// - 引子：鲁特琴的分解和弦，维奥尔琴低低地起一句；
// - A：中音竖笛唱主题（A 大三和弦上的降 B 是南方的颜色），鲁特琴一直分解；A′：短号唱答句，簧管风琴的长音与意大利铃鼓轻轻跟上；
// - B：转到 F 大调一侧，便携管风琴唱“渔船上的灯”，维奥尔琴在下面三度、六度地陪着；
// - 最后一遍 A′ 竖笛与维奥尔琴（低八度）齐奏；尾声落回主音。
// 弦乐群与拨奏低音只做极轻的衬底（管弦版换成真的弦乐）。
import type { TrackDef } from "../score";

export const SEA_TYRRHENIAN: TrackDef = {
  id: "sea_tyrrhenian",
  title: { zh: "第勒尼安的夏夜" },
  qpm: 80,
  meter: [6, 8],
  key: "D minor",
  level: 1.26,
  space: 1.1,
  voices: {
    reca: { inst: "rec_alto", gain: 0.5, pan: 0.1, reverb: 0.36 },
    cornett: { inst: "cornett", gain: 0.5, pan: -0.16, reverb: 0.36 },
    gamba: { inst: "gamba", gain: 0.54, pan: -0.08, reverb: 0.32 },
    org: { inst: "organetto", gain: 0.46, pan: 0.18, reverb: 0.34 },
    larp: { inst: "liuto", gain: 0.34, pan: 0.3, reverb: 0.28, pattern: { kind: "arp", low: 50, steps: "1 5 8 10 8 5", ring: 2 } },
    regal: { inst: "regal", gain: 0.16, pan: -0.26, reverb: 0.4, pattern: { kind: "pad", low: 53, high: 69, size: 3 } },
    tamb: { inst: "perc", gain: 0.26, pan: 0.2, reverb: 0.26, pattern: { kind: "drum", steps: "T..s.t", hits: { T: ["tamburello", 0.5], s: ["tamburello_shake", 0.3], t: ["tamburello", 0.3] } } },
    // 衬底（合成）
    pad: { inst: "strings", gain: 0.15, pan: -0.2, reverb: 0.44, pattern: { kind: "pad", low: 55, high: 72, size: 3 } },
    pz: { inst: "pizz", gain: 0.18, pan: 0.05, reverb: 0.16, pattern: { kind: "arp", low: 38, steps: "1 . . 5, . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "Dm | A",
      lines: { motif: "z3 A,>B, A, | ^C6" },
    },
    A: {
      bars: 8,
      chords: "Dm | Gm | A | Dm | F | Gm | Dm*3 A*3 | Dm",
      lines: {
        mel: "A>B A d2 e | f>e d B2 G | A>B ^c e2 ^c | d3 A3 | c>d c f2 a | b>a g d2 B | A2 d ^c2 e | d6",
      },
    },
    A2: {
      bars: 8,
      chords: "Dm | C | F | A | Dm | Gm | A | Dm",
      lines: {
        mel2: "d>e d f2 a | g>f e c2 e | f>g f a2 c' | a3 e2 ^c | d>e f a2 f | g>f e d2 B | ^c>d e A2 ^c | d6",
      },
    },
    B: {
      bars: 8,
      chords: "F | C | Dm | A | Bb | F | Gm | A",
      lines: {
        bmel: "c3 f3 | e3 g2 e | f3 d2 A | ^c3 e3 | d3 f2 d | c3 A2 c | B3 d2 B | A3 ^c3",
        bcnt: "A3 A3 | G3 c3 | A3 F3 | E3 A3 | F3 B3 | A3 F3 | G3 G3 | E3 E3",
      },
    },
    outro: {
      bars: 2,
      chords: "Gm | Dm",
      lines: { tag: "g>f e d2 ^c | d6" },
    },
  },
  forms: [
    [
      { s: "intro", play: "motif:gamba larp", dyn: 0.5, to: 0.56 },
      { s: "A", play: "mel:reca larp pz", dyn: 0.6 },
      { s: "A2", play: "mel2:cornett larp regal pz tamb", dyn: 0.62 },
      { s: "B", play: "bmel:org bcnt:gamba larp pad pz", dyn: 0.62, to: 0.66 },
      { s: "A2", play: "mel2:reca mel2:gamba-12 larp regal pad pz tamb", dyn: 0.66, to: 0.62 },
      { s: "outro", play: "tag:gamba-12 larp pad", dyn: 0.56, to: 0.4, rit: 0.8 },
    ],
    [
      { s: "intro", play: "motif:gamba larp", dyn: 0.5, to: 0.54 },
      { s: "A", play: "mel:cornett larp pz", dyn: 0.58 },
      { s: "B", play: "bmel:reca bcnt:gamba larp pad pz", dyn: 0.6 },
      { s: "B", play: "bmel:org bcnt:gamba larp regal pad pz tamb", dyn: 0.64, to: 0.66 },
      { s: "A2", play: "mel2:reca mel2:gamba-12 larp regal pad pz tamb", dyn: 0.66, to: 0.62 },
      { s: "outro", play: "tag:gamba-12 larp pad", dyn: 0.56, to: 0.4, rit: 0.8 },
    ],
  ],
  rest: [25, 45],
};
