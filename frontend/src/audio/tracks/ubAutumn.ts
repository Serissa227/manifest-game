// 《晒场上的风》：养成篇的平时曲——秋天（九到十一月轮得到它）。收下来的东西摊在场上晒，大人忙，孩子在垛子之间跑。旋律原创。
// 第九批 A01（2026-11-11）新写。A 多利亚（D 大三和弦里的升 F 是亮的那一下），4/4 拍（每分钟 112 拍），一支收成时节的舞曲：
// - 引子：弦乐的拨奏与小鼓起步子，长笛吹一句；
// - A：提琴领奏——开头是养成篇的成长动机（E → A → B → C：5 → 1 → 2 → 3，小调里的三音），一路小跑；
// - A′：长笛在 C 大调一侧唱答句，更亮；
// - B：慢半步的一段——竖笛（管弦版是单簧管）唱傍晚的凉意，最后借 E 大三和弦（升 G）回到主调；
// - 最后一遍 A′ 长笛与提琴一起，铃鼓加进来；尾声收在主和弦上。
// 管弦版：独奏小提琴、长笛、单簧管，小提琴组的拨奏分解，弦乐的和弦长音，大提琴与低音提琴的拨奏，铃鼓与响棒。
import type { TrackDef } from "../score";

export const UB_AUTUMN: TrackDef = {
  id: "ub_autumn",
  title: { zh: "晒场上的风" },
  qpm: 112,
  meter: [4, 4],
  key: "A dorian",
  level: 1.19,
  voices: {
    fid: { inst: "fiddle", gain: 0.48, pan: -0.26, reverb: 0.32 },
    fl: { inst: "flute", gain: 0.44, pan: -0.06, reverb: 0.36 },
    cl: { inst: "recorder", gain: 0.46, pan: 0.12, reverb: 0.34 },
    lute: { inst: "lute", gain: 0.3, pan: 0.3, reverb: 0.24, pattern: { kind: "arp", low: 57, steps: "1 5 8 5 10 5 8 5", ring: 1 } },
    pad: { inst: "strings", gain: 0.13, pan: 0.16, reverb: 0.42, pattern: { kind: "pad", low: 55, high: 72, size: 3 } },
    pz: { inst: "pizz", gain: 0.24, pan: 0.1, reverb: 0.16, pattern: { kind: "arp", low: 33, steps: "1 . . . 5 . 1 .", ring: 2 } },
    drum: { inst: "perc", gain: 0.3, pan: 0.04, reverb: 0.22, pattern: { kind: "drum", steps: "T..rT.r.", hits: { T: ["tabor", 0.5], r: ["riq", 0.3] } } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "Am | D | Am | E",
      lines: { call: "z8 | z8 | e2 c e a2 e2 | ^g8" },
    },
    A: {
      bars: 8,
      chords: "Am | D | Am | Em | Am | D | G*4 Em*4 | Am",
      lines: {
        // 成长动机：E → A → B → C
        mel: "E2 A2 B c2 B | A2 d2 f2 d2 | e2 c e a2 e2 | g2 e2 B4 | c2 e2 a2 g a | f2 a f d2 A2 | B2 d2 e2 g2 | a8",
      },
    },
    A2: {
      bars: 8,
      chords: "C | G | Am | Em | C | D | Em | Am",
      lines: {
        mel2: "g2 e g c'2 g2 | b2 g2 d4 | c2 e a g2 e2 | g2 e B e2 B2 | e2 g c' b2 g2 | a2 f2 d2 f2 | g2 f e d2 B2 | A8",
      },
    },
    B: {
      bars: 8,
      chords: "Em | Em | D | Am | C | G | D | E",
      lines: {
        bmel: "B4 e3 d | B2 G2 E4 | F3 A d2 A2 | c4 A4 | e4 g3 e | d2 B2 G4 | A2 d2 f2 a2 | ^g6 e2",
      },
    },
    coda: {
      bars: 4,
      chords: "D | Em | Am | Am",
      lines: { end: "f2 a f d2 A2 | B2 d2 e2 g2 | a8- | a8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:fl lute pz drum", dyn: 0.54, to: 0.6 },
      { s: "A", play: "mel:fid lute pz drum", dyn: 0.64 },
      { s: "A2", play: "mel2:fl lute pad pz drum", dyn: 0.66 },
      { s: "B", play: "bmel:cl lute pad pz", dyn: 0.6, to: 0.64 },
      { s: "A2", play: "mel2:fl mel2:fid lute pad pz drum", dyn: 0.7 },
      { s: "coda", play: "end:fid lute pad pz drum", dyn: 0.62, to: 0.44, rit: 0.86 },
    ],
    [
      { s: "intro", play: "call:fl lute pz", dyn: 0.54, to: 0.58 },
      { s: "A", play: "mel:cl lute pz drum", dyn: 0.6 },
      { s: "B", play: "bmel:fid lute pad pz", dyn: 0.62 },
      { s: "A", play: "mel:fid lute pad pz drum", dyn: 0.66 },
      { s: "A2", play: "mel2:fl mel2:fid lute pad pz drum", dyn: 0.7 },
      { s: "coda", play: "end:fid lute pad pz drum", dyn: 0.62, to: 0.44, rit: 0.86 },
    ],
  ],
  rest: [10, 16],
};
