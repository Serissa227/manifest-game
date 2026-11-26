// 《白墙与钟楼》：埃斯佩兰王国的港口（地中海风）。A 小调 6/8 拍的塔兰泰拉舞曲，
// 曼陀林领奏（长音用震音），吉他扫弦、铃鼓与框鼓打拍子，开头远处的钟楼敲一下；
// 第二遍 A 段起提琴在下方加一条和声，B 段转到 C 大调一侧再经 E7 回来。
import type { TrackDef } from "../score";

export const MEDITERRANEAN: TrackDef = {
  id: "port_mediterranean",
  title: { zh: "白墙与钟楼", en: "White Walls and Bell Towers" },
  qpm: 144,
  meter: [6, 8],
  key: "A minor",
  voices: {
    mandolin: { inst: "mandolin", gain: 0.72, pan: -0.15, reverb: 0.22 },
    fiddle: { inst: "fiddle", gain: 0.3, pan: 0.25, reverb: 0.22 },
    guitar: { inst: "guitar", gain: 0.16, pan: 0.3, reverb: 0.18, pattern: { kind: "strum", low: 40, high: 64, steps: "D . u D . u" } },
    pizz: { inst: "pizz", gain: 0.38, pan: 0.05, reverb: 0.15, pattern: { kind: "arp", low: 36, steps: "1 . . 5, . .", ring: 2 } },
    tamb: { inst: "perc", gain: 0.42, pan: -0.3, reverb: 0.2, pattern: { kind: "drum", steps: "X.xX.x", hits: { X: ["riq", 0.6], x: ["shake", 0.35] } } },
    drum: { inst: "perc", gain: 0.3, pan: 0.15, reverb: 0.2, pattern: { kind: "drum", steps: "D..d..", hits: { D: ["bodhran", 0.6], d: ["tip", 0.4] } } },
    bell: { inst: "bell", gain: 0.34, pan: 0.45, reverb: 0.7 },
  },
  sections: {
    intro: { bars: 2, chords: "Am | E7", lines: { bell: "A,6 | z6" } },
    A: {
      bars: 8,
      chords: "Am | Am | Dm | E | E7 | Am | Dm E | Am",
      lines: {
        mel: `E A c e2 c | A c e a2 e | f2 e d2 c | B ^G B e3 |
              d2 c B2 A | c2 B A2 E | F2 A ^G2 B | A3 A,3`,
        harm: `C E A c2 A | E A c e2 c | d2 c B2 A | ^G E ^G B3 |
               B2 A ^G2 E | A2 ^G E2 C | D2 F E2 ^G | E3 E,3`,
      },
    },
    B: {
      bars: 8,
      chords: "C | G | C | G7 | Am | Dm | E7 | Am",
      lines: {
        mel: `g2 e c2 e | d2 B G2 B | c2 e g2 c' | b2 a g2 f |
              e2 c A2 c | d2 f a2 f | e2 d c2 B | A3 z3`,
        harm: `e2 c G2 c | B2 G D2 G | G2 c e2 g | g2 f e2 d |
               c2 A E2 A | A2 d f2 d | ^G2 B A2 ^G | E3 z3`,
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "bell:bell guitar tamb", dyn: 0.62 },
      { s: "A", play: "mel:mandolin guitar pizz tamb", dyn: 0.66 },
      { s: "A", play: "mel:mandolin harm:fiddle guitar pizz tamb drum", dyn: 0.72 },
      { s: "B", play: "mel:mandolin guitar pizz tamb drum", dyn: 0.72 },
      { s: "B", play: "mel:mandolin harm:fiddle guitar pizz tamb drum", dyn: 0.78, rit: 0.9 },
    ],
    [
      { s: "A", play: "mel:fiddle guitar pizz", dyn: 0.62 },
      { s: "A", play: "mel:mandolin harm:fiddle guitar pizz tamb", dyn: 0.7 },
      { s: "B", play: "mel:mandolin guitar pizz tamb drum", dyn: 0.72 },
      { s: "B", play: "mel:fiddle harm:mandolin guitar pizz tamb drum", dyn: 0.76, rit: 0.9 },
    ],
  ],
  rest: [10, 18],
};
