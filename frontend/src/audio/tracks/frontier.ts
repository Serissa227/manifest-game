// 《拓荒者的篝火》：新大陆的殖民地与荒野海湾（开拓者风）。A 多利亚调式 3/4 拍的慢圆舞，
// 营火边一把提琴拉着有点寂寞的调子，吉他按“嘭 · 恰 · 恰”扫弦；B 段升到高处，第二次时木笛在上方和一条高声部。
import type { TrackDef } from "../score";

export const FRONTIER: TrackDef = {
  id: "port_frontier",
  title: { zh: "拓荒者的篝火", en: "Frontier Fires" },
  qpm: 96,
  meter: [3, 4],
  key: "A dorian",
  voices: {
    fiddle: { inst: "fiddle", gain: 0.58, pan: -0.12, reverb: 0.3 },
    flute: { inst: "flute", gain: 0.42, pan: 0.25, reverb: 0.35 },
    cittern: { inst: "cittern", gain: 0.5, pan: -0.2, reverb: 0.25 },
    guitar: { inst: "guitar", gain: 0.25, pan: 0.3, reverb: 0.22, pattern: { kind: "strum", low: 40, high: 64, steps: "D . d . d ." } },
    cello: { inst: "cello", gain: 0.4, pan: 0.05, reverb: 0.22, pattern: { kind: "arp", low: 36, steps: "1 . . . 5, ." } },
    drum: { inst: "perc", gain: 0.42, pan: 0.1, reverb: 0.25, pattern: { kind: "drum", steps: "D...t.", hits: { D: ["bodhran", 0.45], t: ["tip", 0.25] } } },
  },
  sections: {
    intro: { bars: 2, chords: "Am | E" },
    A: {
      bars: 16,
      chords: "Am | Am | G | G | Am | D | Em | Em | Am | Am | G | D | Em | D | Em | Am",
      lines: {
        mel: `E2 A2 B2 | c4 B A | G2 B2 d2 | e4 d B |
              A2 c2 e2 | f4 e d | e2 B2 G2 | B6 |
              E2 A2 B2 | c4 d e | d2 B2 G2 | A4 B c |
              B2 A2 G2 | F2 A2 d2 | e2 d2 B2 | A6`,
      },
    },
    B: {
      bars: 8,
      chords: "C | G | Am | Em | D | C | D | E",
      lines: {
        mel: `e4 g2 | d4 B2 | c4 e2 | B6 |
              a4 f2 | g4 e2 | f2 e2 d2 | e6`,
        desc: `c'4 b2 | g4 d2 | e4 a2 | g6 |
               f4 d2 | e4 c2 | d2 c2 A2 | B6`,
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "guitar", dyn: 0.55 },
      { s: "A", play: "mel:fiddle guitar cello", dyn: 0.62 },
      { s: "B", play: "mel:fiddle guitar cello drum", dyn: 0.66 },
      { s: "B", play: "mel:fiddle desc:flute guitar cello drum", dyn: 0.7 },
      { s: "A", play: "mel:fiddle guitar cello drum", dyn: 0.66, rit: 0.88 },
    ],
    [
      { s: "A", play: "mel:cittern guitar cello", dyn: 0.6 },
      { s: "B", play: "mel:fiddle guitar cello", dyn: 0.64 },
      { s: "B", play: "mel:fiddle desc:flute guitar cello drum", dyn: 0.68 },
      { s: "A", play: "mel:fiddle mel:cittern guitar cello drum", dyn: 0.66, rit: 0.88 },
    ],
  ],
  rest: [12, 22],
};
