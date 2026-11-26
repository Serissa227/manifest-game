// 《新叶》：养成篇的平时曲——春天（三到五月轮得到它）。院子里的树冒了新叶，天亮得早了，上学的路上有鸟叫。旋律原创。
// 第九批 A01（2026-11-11）新写。D 大调，6/8 拍（每分钟 108 个四分音符，附点四分音符一拍 72：轻快的小跑），亮、轻：
// - 引子：竖琴的分解和弦，长笛像鸟一样叫一句；
// - A：长笛唱主题——开头是养成篇的成长动机（A → D → E → 升F：5 → 1 → 2 → 3），一句往上、一句荡回来，停在三音上；
// - A′：小提琴组接着唱答句（爬到高音 D），大提琴在下面走对旋律；
// - B：转到 B 小调一侧，双簧管唱一段软一点的旋律（春寒），停在属和弦上；
// - 再现时长笛与小提琴一起；尾声收在主和弦上。
// 管弦版：长笛、小提琴、双簧管、大提琴、竖琴，弦乐的和弦长音与低音提琴的拨奏。没有打击乐。
import type { TrackDef } from "../score";

export const UB_SPRING: TrackDef = {
  id: "ub_spring",
  title: { zh: "新叶" },
  qpm: 108,
  meter: [6, 8],
  key: "D major",
  level: 1.11,
  voices: {
    fl: { inst: "flute", gain: 0.46, pan: -0.08, reverb: 0.36 },
    vns: { inst: "violins", gain: 0.46, pan: -0.3, reverb: 0.36 },
    ob: { inst: "reed", gain: 0.44, pan: 0.06, reverb: 0.34 },
    vcs: { inst: "celli", gain: 0.4, pan: 0.26, reverb: 0.3 },
    hp: { inst: "harp", gain: 0.32, pan: -0.36, reverb: 0.38, pattern: { kind: "arp", low: 50, steps: "1 5 8 10 8 5", ring: 2 } },
    pad: { inst: "strings", gain: 0.14, pan: 0.18, reverb: 0.42, pattern: { kind: "pad", low: 57, high: 74, size: 3 } },
    pz: { inst: "pizz", gain: 0.22, pan: 0.08, reverb: 0.16, pattern: { kind: "arp", low: 38, steps: "1 . . 5, . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "D | G | D | A",
      lines: { call: "z6 | z3 f2 a | d'3 a2 f | e6" },
    },
    A: {
      bars: 8,
      chords: "D | D | G | D | Bm | Em | A | D",
      lines: {
        // 成长动机：A → D → E → 升F
        mel: "A3 d2 e | f3 a3 | b2 a g2 b | a3 f3 | d2 f b2 a | g2 b g2 e | c2 e a2 g | f6",
      },
    },
    A2: {
      bars: 8,
      chords: "D | F#m | G | A | Bm | G | A | D",
      lines: {
        mel2: "A3 d2 e | f3 c'2 a | b2 d' b2 g | a2 g e3 | f2 d f2 b | g2 b d'2 b | a2 e c2 e | d6",
        cnt: "F3 A3 | A3 c3 | B3 d3 | c3 A3 | d3 B3 | B3 G3 | A3 G3 | F6",
      },
    },
    B: {
      bars: 8,
      chords: "Bm | F#m | G | D | Em | Bm | Em*3 A*3 | A",
      lines: {
        bmel: "B3 d2 f | f3 c2 A | B3 d2 g | f3 d3 | e3 g2 b | b3 f2 d | e2 g a2 c | e6",
      },
    },
    coda: {
      bars: 4,
      chords: "G | A | D | D",
      lines: { end: "b2 g e2 g | a2 e c2 e | d6- | d6" },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:fl hp pad", dyn: 0.5, to: 0.56 },
      { s: "A", play: "mel:fl hp pz", dyn: 0.6 },
      { s: "A2", play: "mel2:vns cnt:vcs-12 hp pad pz", dyn: 0.64 },
      { s: "B", play: "bmel:ob hp pad", dyn: 0.6 },
      { s: "A", play: "mel:fl mel:vns hp pad pz", dyn: 0.64 },
      { s: "A2", play: "mel2:vns mel2:fl cnt:vcs-12 hp pad pz", dyn: 0.68, to: 0.64 },
      { s: "coda", play: "end:fl hp pad pz", dyn: 0.58, to: 0.42, rit: 0.84 },
    ],
    [
      { s: "intro", play: "call:fl hp", dyn: 0.5 },
      { s: "A", play: "mel:ob hp pz", dyn: 0.58 },
      { s: "A2", play: "mel2:fl cnt:vcs-12 hp pad pz", dyn: 0.62 },
      { s: "B", play: "bmel:vns hp pad", dyn: 0.6 },
      { s: "B", play: "bmel:ob hp pad pz", dyn: 0.62 },
      { s: "A2", play: "mel2:vns mel2:fl cnt:vcs-12 hp pad pz", dyn: 0.68, to: 0.64 },
      { s: "coda", play: "end:fl hp pad pz", dyn: 0.58, to: 0.42, rit: 0.84 },
    ],
  ],
  rest: [10, 16],
};
