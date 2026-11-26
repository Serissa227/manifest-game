// 《黑帆》：遭遇海盗与海战。D 小调 6/8 拍，大提琴不停的顿弓固定音型、战鼓与定音鼓打在第一、四拍，
// 圆号吹出空五度的号角，B 段提琴奔跑的八分音符、军鼓加密，圆号在下面拉长音。奏完一遍不停，直接从头再来。
import type { TrackDef } from "../score";

export const BATTLE: TrackDef = {
  id: "battle",
  title: { zh: "黑帆", en: "Black Sails" },
  qpm: 162,
  meter: [6, 8],
  key: "D minor",
  voices: {
    horn: { inst: "horn", gain: 0.62, pan: -0.15, reverb: 0.35 },
    fiddle: { inst: "fiddle", gain: 0.55, pan: 0.2, reverb: 0.28 },
    ost: { inst: "cello", gain: 0.63, pan: 0.1, reverb: 0.2, pattern: { kind: "arp", low: 38, steps: "1 1 8 1 5 1" } },
    strings: { inst: "strings", gain: 0.42, pan: -0.25, reverb: 0.4, pattern: { kind: "pad", low: 50, high: 67, size: 3 } },
    timp: { inst: "timpani", gain: 0.52, pan: 0, reverb: 0.3, pattern: { kind: "arp", low: 38, steps: "1 - - 5, - -" } },
    taiko: { inst: "perc", gain: 0.23, pan: 0.05, reverb: 0.3, pattern: { kind: "drum", steps: "T..t..", hits: { T: ["taiko", 0.8], t: ["taiko", 0.45] } } },
    snare: {
      inst: "perc",
      gain: 0.52,
      pan: -0.15,
      reverb: 0.25,
      pattern: {
        a: { kind: "drum", steps: "..s..s", hits: { s: ["snare", 0.45] } },
        b: { kind: "drum", steps: "..s.ss", hits: { s: ["snare", 0.5] } },
      },
    },
    cymbal: { inst: "perc", gain: 0.14, pan: 0.3, reverb: 0.4, pattern: { kind: "drum", steps: "C" + ".".repeat(47), hits: { C: ["cymbal", 0.7] } } },
  },
  sections: {
    intro: { bars: 2, chords: "Dm | Dm", lines: { call: "D3 A3 | d6" } },
    A: {
      bars: 8,
      chords: "Dm | Dm | Bb | A | Dm | Gm | A7 | Dm",
      lines: {
        mel: `D3 A3 | d2 c A2 F | B3 d3 | ^c3 A3 |
              D3 A3 | B2 A G2 B | A2 G F2 E | D6`,
      },
    },
    B: {
      bars: 8,
      chords: "Dm | C | Bb | A | Dm | Gm | A7 | Dm",
      lines: {
        mel: `d e f a f d | c d e g e c | B c d f d B | ^c d e a e ^c |
              d f a d' a f | g a b g d B | a g f e ^c A | d6`,
        cnt: "A6 | G6 | F6 | E6 | A6 | B6 | ^c6 | d6",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:horn taiko timp", dyn: 0.72 },
      { s: "A", play: "mel:horn ost strings timp taiko", dyn: 0.72 },
      { s: "A", play: "mel:horn mel:fiddle~2 ost strings timp taiko snare", dyn: 0.78 },
      { s: "B", play: "mel:fiddle cnt:horn ost timp taiko snare.b cymbal", dyn: 0.8 },
      { s: "B", play: "mel:fiddle cnt:horn-12 ost strings timp taiko snare.b", dyn: 0.84 },
    ],
    [
      { s: "A", play: "mel:horn ost timp taiko", dyn: 0.72 },
      { s: "A", play: "mel:fiddle mel:horn~-2 ost strings timp taiko snare", dyn: 0.78 },
      { s: "B", play: "mel:fiddle cnt:horn ost timp taiko snare.b cymbal", dyn: 0.8 },
      { s: "B", play: "mel:fiddle cnt:horn ost strings timp taiko snare.b", dyn: 0.84 },
    ],
  ],
  rest: [0, 0],
};
