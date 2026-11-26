// 《风车与账簿》：范德兰联省的港口（低地风）。F 大调 4/4 拍的文艺复兴式圆舞（ronde），
// 开头钟楼的排钟先把第一句敲一遍；竖笛领奏，第二遍加一支次中音竖笛的和声，鲁特琴、羽管键琴与维奥尔琴伴奏，塔博鼓打步子。
import type { TrackDef } from "../score";

export const LOWLAND: TrackDef = {
  id: "port_lowland",
  title: { zh: "风车与账簿", en: "Windmills and Ledgers" },
  qpm: 116,
  meter: [4, 4],
  key: "F major",
  voices: {
    recorder: { inst: "recorder", gain: 0.6, pan: -0.15, reverb: 0.28 },
    tenor: { inst: "recorder", gain: 0.4, pan: 0.2, reverb: 0.28 },
    lute: { inst: "lute", gain: 0.3, pan: 0.3, reverb: 0.25, pattern: { kind: "arp", low: 43, steps: "1 5 8 10 8 5 8 10", ring: 2 } },
    tune: { inst: "lute", gain: 0.55, pan: 0.15, reverb: 0.25 },
    cembalo: { inst: "harpsichord", gain: 0.2, pan: -0.3, reverb: 0.25, pattern: { kind: "strum", low: 48, high: 72, steps: "D . d . D . d .", spread: 0.02 } },
    viol: { inst: "cello", gain: 0.42, pan: 0.05, reverb: 0.22, pattern: { kind: "arp", low: 36, steps: "1 . . . 5, . . ." } },
    tabor: { inst: "perc", gain: 0.64, pan: -0.05, reverb: 0.22, pattern: { kind: "drum", steps: "X.xxX.x.", hits: { X: ["tabor", 0.7], x: ["tabor", 0.4] } } },
    carillon: { inst: "carillon", gain: 0.66, pan: 0.35, reverb: 0.7 },
  },
  sections: {
    bells: {
      bars: 4,
      chords: "F | Bb | F | C",
      lines: { car: "F2 A2 c2 c2 | d2 c2 B2 A2 | A2 G2 F2 A2 | G4 C4" },
    },
    A: {
      bars: 8,
      chords: "F | Bb | F | C | F | C7 | F Bb | C F",
      lines: {
        mel: `F2 A2 c2 c2 | d2 c2 B2 A2 | A2 G2 F2 A2 | G4 C4 |
              F2 A2 c2 f2 | e2 d2 c2 B2 | A2 F2 d2 B2 | c4 F4`,
        harm: `C2 F2 A2 A2 | B2 A2 G2 F2 | F2 E2 C2 F2 | E8 |
               C2 F2 A2 c2 | c2 B2 A2 G2 | F2 C2 B2 F2 | E4 C4`,
      },
    },
    B: {
      bars: 8,
      chords: "C | F | Gm | C | Dm | Bb | C | F",
      lines: {
        mel: `c2 e2 g2 e2 | f2 a2 c'2 a2 | g2 f2 e2 d2 | c4 G4 |
              d2 f2 a2 f2 | g2 f2 d2 B2 | c2 A2 G2 E2 | F8`,
        harm: `G2 c2 e2 c2 | c2 f2 a2 f2 | e2 d2 c2 B2 | G4 E4 |
               A2 d2 f2 d2 | B2 A2 F2 D2 | E2 F2 E2 C2 | C8`,
      },
    },
  },
  forms: [
    [
      { s: "bells", play: "car:carillon", dyn: 0.7 },
      { s: "A", play: "mel:recorder lute viol tabor", dyn: 0.66 },
      { s: "A", play: "mel:recorder harm:tenor cembalo lute viol tabor", dyn: 0.72 },
      { s: "B", play: "mel:recorder cembalo viol tabor", dyn: 0.72 },
      { s: "B", play: "mel:recorder harm:tenor cembalo lute viol tabor", dyn: 0.76, rit: 0.9 },
    ],
    [
      { s: "A", play: "mel:tune cembalo viol", dyn: 0.62 },
      { s: "A", play: "mel:recorder harm:tenor lute viol tabor", dyn: 0.7 },
      { s: "B", play: "mel:recorder cembalo lute viol tabor", dyn: 0.72 },
      { s: "B", play: "mel:recorder harm:tenor cembalo viol tabor", dyn: 0.76, rit: 0.9 },
    ],
  ],
  rest: [10, 18],
};
