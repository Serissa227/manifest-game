// 《并肩的归途》：养成篇的情境音乐——心动（情绪 tender 的事件，与《指尖的余温》轮着放）。两个人一起走回去，谁也没说什么，步子不知不觉对齐了。旋律原创。
// 第九批 A01（2026-11-11）新写。A 大调，6/8 拍（每分钟 84 个四分音符，附点四分音符一拍 56：慢慢走的步子），柔、近：
// - 引子：竖琴的分解和弦，竖笛（管弦版是单簧管）带一句弱起；
// - A：独奏小提琴唱主题，停在三音上，没说完；
// - A′：小提琴再唱一遍，这回单簧管在下面三度、六度地陪着（两个人的步子），落在主音上；
// - B：转到升 F 小调一侧，大提琴唱一段——心里的话，停在属和弦上；
// - 尾声长笛跟着小提琴收住。
// 管弦版：独奏小提琴、单簧管、大提琴、长笛、竖琴，弦乐的和弦长音与低音提琴的拨奏。没有打击乐。
import type { TrackDef } from "../score";

export const UB_HEART_WALK: TrackDef = {
  id: "ub_heart_walk",
  title: { zh: "并肩的归途" },
  qpm: 84,
  meter: [6, 8],
  key: "A major",
  level: 1.19,
  voices: {
    vn: { inst: "fiddle", gain: 0.48, pan: -0.26, reverb: 0.38 },
    cl: { inst: "recorder", gain: 0.42, pan: 0.12, reverb: 0.36 },
    vc: { inst: "cello", gain: 0.46, pan: 0.26, reverb: 0.34 },
    fl: { inst: "flute", gain: 0.36, pan: -0.06, reverb: 0.38 },
    hp: { inst: "harp", gain: 0.32, pan: -0.38, reverb: 0.4, pattern: { kind: "arp", low: 45, steps: "1 5 8 10 8 5", ring: 2 } },
    pad: { inst: "strings", gain: 0.14, pan: 0.14, reverb: 0.44, pattern: { kind: "pad", low: 57, high: 73, size: 3 } },
    pz: { inst: "pizz", gain: 0.2, pan: 0.08, reverb: 0.16, pattern: { kind: "arp", low: 33, steps: "1 . . 5 . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "A | D | A | E",
      lines: { pick: "z6 | z6 | z3 e2 f | g6" },
    },
    A: {
      bars: 8,
      chords: "A | F#m | D | E | A | C#m | D*3 E*3 | A",
      lines: {
        mel: "e3 c2 e | f3 a2 f | f2 e d2 f | e3 B3 | c2 e a2 e | g3 e2 c | d2 f e2 B | c6",
      },
    },
    A2: {
      bars: 8,
      chords: "A | F#m | D | E | F#m | D | E | A",
      lines: {
        mel2: "e3 c2 e | f3 a2 c' | b2 a f2 d | e3 g3 | a3 f2 c | d2 f a2 f | g2 e B2 e | a6",
        // 单簧管在下面三度、六度
        duo: "c3 A2 c | A3 c2 e | d2 c A2 F | B3 e3 | c3 A2 A | F2 A d2 d | e2 B G2 B | c6",
      },
    },
    B: {
      bars: 8,
      chords: "F#m | C#m | D | A | Bm | F#m | Bm*3 E*3 | E",
      lines: {
        bmel: "F,3 A,2 C | E3 C2 G, | F,3 A,2 D | C3 A,3 | B,3 D2 F | F3 C2 A, | B,2 D E2 G | E6",
      },
    },
    coda: {
      bars: 4,
      chords: "D | E | A | A",
      lines: { end: "f2 a f2 d | e2 g b2 g | a6- | a6" },
    },
  },
  forms: [
    [
      { s: "intro", play: "pick:cl hp pad", dyn: 0.48, to: 0.54 },
      { s: "A", play: "mel:vn hp pz", dyn: 0.58 },
      { s: "A2", play: "mel2:vn duo:cl hp pad pz", dyn: 0.62 },
      { s: "B", play: "bmel:vc hp pad", dyn: 0.6, to: 0.64 },
      { s: "A2", play: "mel2:vn duo:cl hp pad pz", dyn: 0.64, to: 0.6 },
      { s: "coda", play: "end:vn end:fl hp pad", dyn: 0.54, to: 0.38, rit: 0.82 },
    ],
    [
      { s: "intro", play: "pick:cl hp", dyn: 0.48, to: 0.52 },
      { s: "A", play: "mel:fl hp pz", dyn: 0.56 },
      { s: "B", play: "bmel:vc hp pad", dyn: 0.6 },
      { s: "A", play: "mel:vn hp pad pz", dyn: 0.6 },
      { s: "A2", play: "mel2:vn duo:cl hp pad pz", dyn: 0.64, to: 0.6 },
      { s: "coda", play: "end:vn end:fl hp pad", dyn: 0.54, to: 0.38, rit: 0.82 },
    ],
  ],
  rest: [8, 14],
};
