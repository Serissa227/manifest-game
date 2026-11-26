// 《熄灯以后》：养成篇的情境音乐——悲伤（情绪 sad 的事件，与《落雨的庭院》轮着放）。灯吹了，屋里的人都睡了，只有自己还睁着眼。旋律原创。
// 第九批 A01（2026-11-11）新写。G 小调，4/4 拍（每分钟 58 拍），很慢，句子之间留着空：
// - 引子：竖琴很慢的分解和弦，弦乐的长音；
// - A：双簧管唱主题（从五音一步步落到主音，再想往上、又落回来），D 大三和弦的升 F 是唯一亮的地方；
// - B：大提琴独自说四小节（降 E → 降 B → C 小 → D），像一口没叹出来的气；
// - A′：独奏小提琴再唱主题，大提琴在下面三度、六度地托着；尾声停在主和弦的五音上，没有落到底。
// 管弦版：双簧管、独奏小提琴、大提琴、竖琴，弦乐的和弦长音与低音提琴的长音。没有打击乐。
import type { TrackDef } from "../score";

const MEL = "d4 B2 G2 | G4 B3 e | e4 d2 c2 | d6 z2 | g4 d2 B2 | f4 d3 B | e2 c2 d2 ^F2 | G8";

export const UB_LAMP_OUT: TrackDef = {
  id: "ub_lamp_out",
  title: { zh: "熄灯以后" },
  qpm: 58,
  meter: [4, 4],
  key: "G minor",
  level: 1.32,
  space: 1.1,
  voices: {
    ob: { inst: "reed", gain: 0.44, pan: 0.06, reverb: 0.4 },
    vn: { inst: "fiddle", gain: 0.46, pan: -0.28, reverb: 0.4 },
    vc: { inst: "cello", gain: 0.46, pan: 0.26, reverb: 0.36 },
    hp: { inst: "harp", gain: 0.3, pan: -0.38, reverb: 0.42, pattern: { kind: "arp", low: 43, steps: "1 . 5 . 8 . 10 .", ring: 4 } },
    pad: { inst: "strings", gain: 0.15, pan: 0.12, reverb: 0.46, pattern: { kind: "pad", low: 55, high: 70, size: 3 } },
    low: { inst: "strings", gain: 0.2, pan: 0.3, reverb: 0.36, pattern: { kind: "pad", low: 31, high: 43, size: 1 } },
  },
  sections: {
    intro: { bars: 2, chords: "Gm | D" },
    A: {
      bars: 8,
      chords: "Gm | Eb | Cm | D | Gm | Bb | Cm*4 D*4 | Gm",
      lines: { mel: MEL },
    },
    B: {
      bars: 4,
      chords: "Eb | Bb | Cm | D",
      lines: { bmel: "G,4 B,3 E | D4 B,4 | C4 E3 G | ^F6 z2" },
    },
    A2: {
      bars: 8,
      chords: "Gm | Eb | Cm | D | Gm | Bb | Cm*4 D*4 | Gm",
      lines: {
        mel: MEL,
        cnt: "B,4 G,4 | B,4 G,4 | C4 E4 | D4 ^F,4 | B,4 D4 | D4 F4 | G,4 A,4 | G,8",
      },
    },
    coda: {
      bars: 2,
      chords: "Cm | Gm",
      lines: { end: "e4 c4 | d8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "hp pad", dyn: 0.44, to: 0.5 },
      { s: "A", play: "mel:ob hp pad", dyn: 0.54 },
      { s: "B", play: "bmel:vc hp pad low", dyn: 0.54, to: 0.58 },
      { s: "A2", play: "mel:vn cnt:vc hp pad low", dyn: 0.58, to: 0.52 },
      { s: "coda", play: "end:ob hp pad low", dyn: 0.48, to: 0.34, rit: 0.8 },
    ],
    [
      { s: "intro", play: "hp pad", dyn: 0.44, to: 0.5 },
      { s: "A", play: "mel:vn hp pad", dyn: 0.54 },
      { s: "B", play: "bmel:vc hp pad low", dyn: 0.54, to: 0.58 },
      { s: "A2", play: "mel:ob cnt:vc hp pad low", dyn: 0.58, to: 0.52 },
      { s: "coda", play: "end:vn hp pad low", dyn: 0.48, to: 0.34, rit: 0.8 },
    ],
  ],
  rest: [10, 16],
};
