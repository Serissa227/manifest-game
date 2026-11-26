// 《海边的风》：养成篇的平时曲——海边（不分文化：放了学跑到海边，风把衣角吹起来，远处有帆）。旋律原创。
// A 大调，3/4 拍（每分钟 120 拍），一支被风推着走的圆舞曲：
// - 引子：钢片琴在高处闪两下（浪尖上的光），竖琴在拍二、拍三上拨和弦；
// - A（十六小节）：长笛唱主题——开头就是养成篇的成长动机（E → A → B → 升C：5 → 1 → 2 → 3），一口气爬到高音 A 再被风吹回来，
//   第七小节借 B7 停在属和弦上，后半句落回主音；低音拨奏落在每小节的第一拍（“嘭 · 嚓 嚓”）；
// - B（八小节）：单簧管（合成版用簧管）在低一些的地方唱一段，第五小节的 G 大三和弦（还原 G：海风里的混合利底亚）；第二遍小提琴高八度接过来；
// - A″：全体，尾声钢片琴再闪一下。
// 管弦版：长笛、单簧管、小提琴、竖琴、钟琴，弦乐的和弦长音很轻，大提琴拨奏与低音提琴拨奏走低音。
import type { TrackDef } from "../score";

export const UB_BREEZE: TrackDef = {
  id: "ub_breeze",
  title: { zh: "海边的风" },
  qpm: 120,
  meter: [3, 4],
  key: "A major",
  level: 1.06,
  voices: {
    flute: { inst: "flute", gain: 0.56, pan: -0.08, reverb: 0.32 },
    reed: { inst: "reed", gain: 0.44, pan: 0.12, reverb: 0.32 },
    fid: { inst: "fiddle", gain: 0.46, pan: 0.18, reverb: 0.34 },
    cel: { inst: "celesta", gain: 0.3, pan: 0.32, reverb: 0.5 },
    hp: { inst: "harp", gain: 0.3, pan: -0.34, reverb: 0.36, pattern: { kind: "arp", low: 45, steps: "- - 5+8 . 8+10 .", ring: 2 } },
    pad: { inst: "strings", gain: 0.12, pan: 0.2, reverb: 0.42, pattern: { kind: "pad", low: 57, high: 71, size: 3 } },
    pz: { inst: "pizz", gain: 0.26, pan: 0.06, reverb: 0.16, pattern: { kind: "arp", low: 33, steps: "1 . . . . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "A | D | A | E",
      lines: { glk: "z2 e'2 c'2 | a6 | z2 e'2 c'2 | b6" },
    },
    A: {
      bars: 16,
      chords: "A | A | D | A | F#m | D | B7 | E | A | A | D | F#m | D | A/E | E | A",
      lines: {
        // 成长动机：E → A → B → 升C
        mel: "E2 A2 B2 | c4 A2 | d2 f2 a2 | a4 e2 | f2 e2 c2 | d4 A2 | B2 ^d2 f2 | e6 | E2 A2 B2 | c4 A2 | d2 f2 a2 | a3 g f2 | f2 d2 B2 | c2 e2 A2 | B4 d2 | A6",
      },
    },
    B: {
      bars: 8,
      chords: "D | A/C# | Bm | F#m | G | D | E | E",
      lines: { bm: "F3 E D2 | E4 C2 | D3 C B,2 | C6 | D3 =C B,2 | A,6 | B,2 E2 G2 | B6" },
    },
    coda: {
      bars: 4,
      chords: "D | E | A | A",
      lines: { end: "f2 e2 d2 | e2 c2 B2 | A6 | z6", glk: "z6 | z6 | z2 e'2 c'2 | a6" },
    },
  },
  forms: [
    [
      { s: "intro", play: "glk:cel hp pad", dyn: 0.5, to: 0.56 },
      { s: "A", play: "mel:flute hp pz pad", dyn: 0.6 },
      { s: "B", play: "bm:reed hp pz pad", dyn: 0.58 },
      { s: "B", play: "bm:fid+12 hp pz pad", dyn: 0.62 },
      { s: "A", play: "mel:flute mel:fid hp pz pad", dyn: 0.66, to: 0.62 },
      { s: "coda", play: "end:flute glk:cel hp pad", dyn: 0.56, to: 0.42, rit: 0.84 },
    ],
    [
      { s: "intro", play: "glk:cel hp", dyn: 0.5 },
      { s: "A", play: "mel:fid hp pz pad", dyn: 0.6 },
      { s: "B", play: "bm:reed hp pz", dyn: 0.58 },
      { s: "B", play: "bm:flute+12 hp pz pad", dyn: 0.62 },
      { s: "A", play: "mel:flute mel:fid hp pz pad", dyn: 0.66, to: 0.62 },
      { s: "coda", play: "end:flute glk:cel hp pad", dyn: 0.56, to: 0.42, rit: 0.84 },
    ],
  ],
  rest: [10, 16],
};
