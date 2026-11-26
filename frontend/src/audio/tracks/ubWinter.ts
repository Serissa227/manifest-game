// 《长夜的灯》：养成篇的平时曲——冬天（十二月到二月轮得到它）。天黑得早，一家人围着一盏灯，各做各的事，外面的风声隔着墙。旋律原创。
// 第九批 A01（2026-11-11）新写。降 A 大调，3/4 拍（每分钟 80 拍），暖、静：
// - 引子：竖琴的分解和弦，钢片琴三个往下落的音（灯花）；
// - A：大提琴在中低音区唱主题——开头是养成篇的成长动机（降E → 降A → 降B → C：5 → 1 → 2 → 3），句子短，像小声说话；
// - A′：小提琴组在高处唱答句，落在主音上；
// - B：转到 F 小调一侧，双簧管唱一段——想起远处的人，停在属和弦上；
// - 最后一遍 A′ 双簧管低八度跟着小提琴；尾声大提琴收住，钢片琴的灯花再落一次。
// 管弦版：大提琴、小提琴、双簧管、钟琴、竖琴，弦乐的和弦长音与低音提琴的长音。没有打击乐。
import type { TrackDef } from "../score";

export const UB_WINTER: TrackDef = {
  id: "ub_winter",
  title: { zh: "长夜的灯" },
  qpm: 80,
  meter: [3, 4],
  key: "Ab major",
  level: 1.24,
  space: 1.05,
  voices: {
    vc: { inst: "cello", gain: 0.5, pan: 0.24, reverb: 0.34 },
    vns: { inst: "violins", gain: 0.44, pan: -0.3, reverb: 0.38 },
    ob: { inst: "reed", gain: 0.42, pan: 0.06, reverb: 0.36 },
    cel: { inst: "celesta", gain: 0.24, pan: 0.3, reverb: 0.54 },
    hp: { inst: "harp", gain: 0.32, pan: -0.38, reverb: 0.4, pattern: { kind: "arp", low: 44, steps: "1 5 8 10 8 5", ring: 2 } },
    pad: { inst: "strings", gain: 0.14, pan: 0.14, reverb: 0.44, pattern: { kind: "pad", low: 56, high: 72, size: 3 } },
    low: { inst: "strings", gain: 0.2, pan: 0.3, reverb: 0.36, pattern: { kind: "pad", low: 32, high: 44, size: 1 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "Ab | Db | Ab | Eb",
      lines: { star: "e'2 c'2 a2 | z6 | e'2 c'2 a2 | b6" },
    },
    A: {
      bars: 8,
      chords: "Ab | Fm | Db | Eb | Ab | Cm | Db*3 Eb*3 | Ab",
      lines: {
        // 成长动机：降E → 降A → 降B → C
        mel: "E,2 A,2 B,2 | C4 A,2 | A,2 D2 F2 | E4 B,2 | C2 E2 A2 | G4 E2 | F2 D B,2 G, | A,6",
      },
    },
    A2: {
      bars: 8,
      chords: "Ab | Eb | Fm | Cm | Db | Ab | Eb | Ab",
      lines: {
        mel2: "e2 a2 c'2 | b4 g2 | a2 f2 c2 | e4 c2 | d2 f2 a2 | c'4 a2 | b2 g2 e2 | a6",
      },
    },
    B: {
      bars: 8,
      chords: "Fm | Cm | Db | Ab | Bbm | Fm | Db | Eb",
      lines: {
        bmel: "c4 f2 | e3 =d c2 | d4 f2 | e4 c2 | d4 B2 | c3 B A2 | F2 A2 d2 | e6",
      },
    },
    coda: {
      bars: 4,
      chords: "Db | Eb | Ab | Ab",
      lines: {
        end: "F2 D2 A,2 | G,2 B,2 E2 | A,6- | A,6",
        star: "z6 | z6 | e'2 c'2 a2 | e'6",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "star:cel hp pad", dyn: 0.48, to: 0.54 },
      { s: "A", play: "mel:vc hp pad", dyn: 0.58 },
      { s: "A2", play: "mel2:vns hp pad low", dyn: 0.6 },
      { s: "B", play: "bmel:ob hp pad low", dyn: 0.58, to: 0.62 },
      { s: "A2", play: "mel2:vns mel2:ob-12 hp pad low", dyn: 0.64, to: 0.58 },
      { s: "coda", play: "end:vc star:cel hp pad low", dyn: 0.52, to: 0.38, rit: 0.82 },
    ],
    [
      { s: "intro", play: "star:cel hp", dyn: 0.48, to: 0.52 },
      { s: "A", play: "mel:ob+12 hp pad", dyn: 0.56 },
      { s: "B", play: "bmel:vns hp pad low", dyn: 0.58 },
      { s: "A", play: "mel:vc hp pad low", dyn: 0.6 },
      { s: "A2", play: "mel2:vns mel2:ob-12 hp pad low", dyn: 0.64, to: 0.58 },
      { s: "coda", play: "end:vc star:cel hp pad low", dyn: 0.52, to: 0.38, rit: 0.82 },
    ],
  ],
  rest: [10, 16],
};
