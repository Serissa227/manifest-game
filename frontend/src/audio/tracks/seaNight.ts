// 《南十字下》：远洋的夜航——风小了，海面黑得像墨，头顶的星一颗一颗亮出来，舵手照着南十字（或北斗）校航向。
// 大西洋、印度洋、太平洋的远洋都轮得到它。第九批 A01（2026-11-11）新写，旋律原创。
// E 大调，4/4 拍（每分钟 60 拍），慢、静、留白多：
// - 引子：钢片琴两颗“星”（B → E），竖琴很慢的分解和弦，弦乐的长音；
// - A：竖笛（管弦版是单簧管）唱一段夜曲，一句八拍，句尾留着空；
// - B：转到升 C 小调一侧，独奏小提琴唱一段更想家的旋律，一步步爬到高处再落下来；
// - A′：长笛接着唱 A，大提琴在下面走对旋律（三度、六度地托着）；尾声钢片琴的星再亮一次。
// 管弦版：单簧管、长笛、独奏小提琴、大提琴、钟琴、竖琴，弦乐的和弦长音与低音提琴的长音。没有打击乐。
import type { TrackDef } from "../score";

const MEL = "B4 e3 f | g4 e4 | c3 d e2 a2 | f6 z2 | B4 e3 g | b4 g2 d2 | c2 e2 d2 B2 | e8";

export const SEA_NIGHT: TrackDef = {
  id: "sea_night",
  title: { zh: "南十字下" },
  qpm: 60,
  meter: [4, 4],
  key: "E major",
  level: 1.36,
  hall: true,
  space: 1.1,
  voices: {
    cl: { inst: "recorder", gain: 0.46, pan: 0.1, reverb: 0.4 },
    fl: { inst: "flute", gain: 0.42, pan: -0.08, reverb: 0.4 },
    vn: { inst: "fiddle", gain: 0.46, pan: -0.3, reverb: 0.4 },
    vc: { inst: "cello", gain: 0.42, pan: 0.26, reverb: 0.34 },
    cel: { inst: "celesta", gain: 0.24, pan: 0.3, reverb: 0.56 },
    hp: { inst: "harp", gain: 0.3, pan: -0.4, reverb: 0.42, pattern: { kind: "arp", low: 40, steps: "1 . 5 . 8 . 10 .", ring: 4 } },
    pad: { inst: "strings", gain: 0.15, pan: 0.12, reverb: 0.46, pattern: { kind: "pad", low: 52, high: 71, size: 3 } },
    low: { inst: "strings", gain: 0.2, pan: 0.3, reverb: 0.36, pattern: { kind: "pad", low: 28, high: 40, size: 1 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "E | A",
      lines: { star: "z4 b2 e'2 | z4 c'2 e'2" },
    },
    A: {
      bars: 8,
      chords: "E | C#m | A | B | E | G#m | A*4 B*4 | E",
      lines: { mel: MEL },
    },
    B: {
      bars: 6,
      chords: "C#m | F#m | B | E | A | B",
      lines: {
        bmel: "c2 e2 g3 e | f2 a2 c'3 a | b4 f2 d2 | e2 g2 b4 | a4 e2 c2 | d4 f4",
      },
    },
    A2: {
      bars: 8,
      chords: "E | C#m | A | B | E | G#m | A*4 B*4 | E",
      lines: {
        mel: MEL,
        // 对旋律：在主题下面三度、六度地托着（大提琴低八度奏）
        cnt: "G4 B4 | c4 G4 | A4 c4 | B4 d4 | G4 B4 | d4 B4 | A4 F4 | G8",
      },
    },
    coda: {
      bars: 2,
      chords: "A | E",
      lines: {
        end: "a4 f2 e2 | e8",
        star: "z8 | z2 b2 e'4",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "star:cel hp pad", dyn: 0.46, to: 0.52 },
      { s: "A", play: "mel:cl hp pad", dyn: 0.56 },
      { s: "B", play: "bmel:vn hp pad low", dyn: 0.58, to: 0.62 },
      { s: "A2", play: "mel:fl cnt:vc-12 hp pad low", dyn: 0.6, to: 0.56 },
      { s: "coda", play: "end:cl star:cel hp pad low", dyn: 0.52, to: 0.38, rit: 0.82 },
    ],
    [
      { s: "intro", play: "star:cel hp", dyn: 0.46, to: 0.5 },
      { s: "A", play: "mel:fl hp pad", dyn: 0.54 },
      { s: "A2", play: "mel:cl cnt:vc-12 hp pad low", dyn: 0.58 },
      { s: "B", play: "bmel:vn hp pad low", dyn: 0.6, to: 0.64 },
      { s: "A2", play: "mel:vn cnt:vc-12 hp pad low", dyn: 0.62, to: 0.56 },
      { s: "coda", play: "end:cl star:cel hp pad low", dyn: 0.52, to: 0.38, rit: 0.82 },
    ],
  ],
  rest: [30, 50],
};
