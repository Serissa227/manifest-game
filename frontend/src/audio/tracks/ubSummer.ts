// 《长昼》：养成篇的平时曲——夏天（六到八月轮得到它）。白天长得好像过不完，午后热得人犯困，井水是凉的。旋律原创。
// 第九批 A01（2026-11-11）新写。G 大调，4/4 拍（每分钟 76 拍），慢悠悠的：
// - 引子：竖琴的分解和弦，圆号远远的两个音；
// - A：竖笛（管弦版是单簧管）唱主题——开头是养成篇的成长动机（D → G → A → B：5 → 1 → 2 → 3），句子拉得长，句尾懒懒地落下来；
// - B：转到 E 小调一侧，圆号唱一段午后的阴凉，停在属和弦上；
// - A′：小提琴组再唱主题，大提琴在下面走长音的对旋律；尾声收在主和弦上。
// 管弦版：单簧管、圆号、小提琴、大提琴、竖琴，弦乐的和弦长音与低音提琴的拨奏。没有打击乐。
import type { TrackDef } from "../score";

const MEL = "D3 G A2 B2 | B4 G2 E2 | E3 G c2 e2 | d6 z2 | B3 d g2 f2 | f4 d2 B2 | c2 e2 d2 A2 | G8";

export const UB_SUMMER: TrackDef = {
  id: "ub_summer",
  title: { zh: "长昼" },
  qpm: 76,
  meter: [4, 4],
  key: "G major",
  level: 1.36,
  voices: {
    cl: { inst: "recorder", gain: 0.48, pan: 0.1, reverb: 0.36 },
    hn: { inst: "horn", gain: 0.46, pan: -0.18, reverb: 0.42 },
    vns: { inst: "violins", gain: 0.44, pan: -0.3, reverb: 0.36 },
    vcs: { inst: "celli", gain: 0.4, pan: 0.26, reverb: 0.3 },
    hp: { inst: "harp", gain: 0.32, pan: -0.36, reverb: 0.4, pattern: { kind: "arp", low: 43, steps: "1 5 8 10 12 10 8 5", ring: 2 } },
    pad: { inst: "strings", gain: 0.14, pan: 0.18, reverb: 0.42, pattern: { kind: "pad", low: 55, high: 72, size: 3 } },
    pz: { inst: "pizz", gain: 0.2, pan: 0.08, reverb: 0.16, pattern: { kind: "arp", low: 31, steps: "1 . . . 5 . . .", ring: 3 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "G | D",
      lines: { call: "z4 D4 | A6 z2" },
    },
    A: {
      bars: 8,
      chords: "G | Em | C | D | G | Bm | C*4 D*4 | G",
      lines: { mel: MEL },
    },
    B: {
      bars: 8,
      chords: "Em | Am | D | G | Em | C | Am | D",
      lines: {
        bmel: "E4 G2 B2 | c4 A4 | F3 A d2 A2 | B6 z2 | G4 B2 e2 | e4 c2 G2 | A2 c2 e2 c2 | d8",
      },
    },
    A2: {
      bars: 8,
      chords: "G | Em | C | D | G | Bm | C*4 D*4 | G",
      lines: {
        mel: MEL,
        cnt: "B,8 | G,8 | G,4 E4 | F4 A4 | G4 D4 | D4 F4 | E4 F4 | D8",
      },
    },
    coda: {
      bars: 2,
      chords: "C | G",
      lines: { end: "e2 c2 G2 E2 | G8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:hn hp pad", dyn: 0.5, to: 0.54 },
      { s: "A", play: "mel:cl hp pz", dyn: 0.58 },
      { s: "B", play: "bmel:hn hp pad pz", dyn: 0.6 },
      { s: "A2", play: "mel:vns cnt:vcs hp pad pz", dyn: 0.64, to: 0.6 },
      { s: "coda", play: "end:cl hp pad", dyn: 0.54, to: 0.4, rit: 0.82 },
    ],
    [
      { s: "intro", play: "call:hn hp", dyn: 0.5 },
      { s: "A", play: "mel:vns hp pz", dyn: 0.56 },
      { s: "A2", play: "mel:cl cnt:vcs hp pad pz", dyn: 0.6 },
      { s: "B", play: "bmel:hn hp pad pz", dyn: 0.6 },
      { s: "A2", play: "mel:vns mel:cl cnt:vcs hp pad pz", dyn: 0.64, to: 0.6 },
      { s: "coda", play: "end:cl hp pad", dyn: 0.54, to: 0.4, rit: 0.82 },
    ],
  ],
  rest: [10, 16],
};
