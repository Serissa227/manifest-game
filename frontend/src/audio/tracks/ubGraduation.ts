// 《各自的帆》：养成篇的结业（1556 年底，结业的那一天与养成结局；1557 年 1 月出海）。D 大调，慢 4/4（每分钟 72 拍），不舍又期待。
// 写在主题曲《船货清单》的 D 大调上：养成的最后一首，接下来就是出海。
// A 段木笛唱主题，开头仍是成长动机（A → D → E → 升 F），这一次接着往上走、停在属和弦上（还没说完）；
// 再唱时提琴组接过来、大提琴在下面拉对位，最后落回主音。B 段经过 G 小三和弦（借来的小调四级：舍不得的那一点）停在 A 七上；
// 全奏的主题之后，尾声圆号吹起全作的“起帆动机”（A → D → A）——同窗各自出海的那一刻，养成篇的动机交给了航海的动机。
import type { TrackDef } from "../score";

export const UB_GRADUATION: TrackDef = {
  id: "ub_graduation",
  title: { zh: "各自的帆", en: "Sails of Our Own" },
  qpm: 72,
  meter: [4, 4],
  key: "D major",
  level: 1.05,
  hall: true,
  voices: {
    violins: { inst: "violins", gain: 0.56, pan: -0.22, reverb: 0.36 },
    flute: { inst: "flute", gain: 0.56, pan: -0.06, reverb: 0.36 },
    horns: { inst: "horns", gain: 0.48, pan: -0.3, reverb: 0.4 },
    cello: { inst: "cello", gain: 0.46, pan: 0.24, reverb: 0.32 },
    celesta: { inst: "celesta", gain: 0.34, pan: 0.32, reverb: 0.55 },
    harp: {
      inst: "harp",
      gain: 0.34,
      pan: -0.32,
      reverb: 0.38,
      pattern: {
        a: { kind: "arp", low: 43, steps: "1 5 8 10 12 10 8 5", ring: 2 },
        b: { kind: "arp", low: 43, steps: "1 . 8 . 10 . 12 .", ring: 3 },
      },
    },
    strings: { inst: "strings", gain: 0.36, pan: 0.18, reverb: 0.42, pattern: { kind: "pad", low: 57, high: 74, size: 3 } },
    low: { inst: "strings", gain: 0.36, pan: 0.06, reverb: 0.32, pattern: { kind: "pad", low: 38, high: 50, size: 1 } },
    timp: { inst: "timpani", gain: 0.34, reverb: 0.36 },
  },
  sections: {
    intro: { bars: 2, chords: "D | G/D" },
    A: {
      bars: 8,
      chords: "D | Bm7 | G | Asus4 A | D/F# | G | Em7 | Asus4 A",
      lines: {
        // 成长动机（A → D → E → 升 F），接着往上走，停在属和弦上
        mel: "A, D E2 F4 | B3 A F2 D2 | G3 F E2 D2 | E6 z2 | F3 G A2 d2 | B4 A2 G2 | G3 F E2 A2 | A6 z2",
      },
    },
    A2: {
      bars: 8,
      chords: "D | Bm7 | G | Asus4 A | D/F# | G | Em7 A7 | D",
      lines: {
        mel2: "A, D E2 F4 | B3 A F2 D2 | G3 F E2 D2 | E6 z2 | F3 G A2 d2 | B4 A2 G2 | G2 F2 E2 C2 | D6 z2",
        cnt: "D4 F,4 | D4 B,4 | B,4 G,4 | A,8 | A,4 D4 | D4 B,4 | B,4 A,4 | F,8",
        timp: "z8 | z8 | z8 | z8 | z8 | z8 | z4 A,,4 | D,,2 z6",
      },
    },
    B: {
      bars: 8,
      chords: "G | D/F# | Em7 | Bm | G | Gm | D/A | A7sus4 A7",
      lines: {
        // G 小三和弦上的降 B：舍不得的那一点
        bmel: "B3 A B2 d2 | A4 F4 | G3 F E2 B2 | F6 z2 | B3 A B2 d2 | _B4 A2 G2 | F3 E D2 F2 | E4 C4",
        timp: "z8 | z8 | z8 | z8 | z8 | z8 | z8 | !trem!A,,8",
      },
    },
    coda: {
      bars: 4,
      chords: "D | G/D | D | D",
      lines: {
        // 起帆动机：养成的动机交给了航海的动机
        motif: "A,3/2 D/2 A6 | B6 A2 | F8 | z8",
        fin: "z8 | z4 B2 A2 | d8 | d8",
        spark: "z8 | z8 | z8 | z2 d'/2f'/2a'/2d''/2 z4",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "harp.b low", dyn: 0.5 },
      { s: "A", play: "mel:flute harp low", dyn: 0.56 },
      { s: "B", play: "bmel:violins harp.b strings low timp:timp", dyn: 0.62, to: 0.7 },
      { s: "A2", play: "mel2:violins mel2:horns-12 cnt:cello harp strings low timp:timp", dyn: 0.72 },
      { s: "coda", play: "motif:horns fin:flute spark:celesta harp.b strings low", dyn: 0.64, to: 0.46, rit: 0.8 },
    ],
    [
      { s: "intro", play: "harp.b", dyn: 0.48 },
      { s: "A", play: "mel:cello harp low", dyn: 0.56 },
      { s: "A2", play: "mel2:flute cnt:cello harp strings low", dyn: 0.6 },
      { s: "B", play: "bmel:violins+12 bmel:flute harp.b strings low timp:timp", dyn: 0.64, to: 0.72 },
      { s: "A2", play: "mel2:violins mel2:horns-12 cnt:cello harp strings low timp:timp", dyn: 0.72 },
      { s: "coda", play: "motif:horns fin:violins spark:celesta harp.b strings low", dyn: 0.62, to: 0.44, rit: 0.8 },
    ],
  ],
  rest: [10, 18],
};
