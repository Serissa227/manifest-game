// 《峡湾炉火》：诺德海姆公国的港口（北地风）。E 小调 3/4 拍的波尔斯卡舞曲，第二拍略早、第三拍略晚，
// 提琴领奏，底下是 E 与 B 的持续音；卡恩特勒琴弹分解和弦，木地板上跺脚打第一、三拍。
import type { TrackDef } from "../score";

export const NORDIC: TrackDef = {
  id: "port_nordic",
  title: { zh: "峡湾炉火", en: "Hearthfire in the Fjord" },
  qpm: 104,
  meter: [3, 4],
  key: "E minor",
  groove: [0, -0.07, 0.03],
  voices: {
    fiddle: { inst: "fiddle", gain: 0.58, pan: -0.12, reverb: 0.3 },
    kantele: {
      inst: "kantele",
      gain: 0.28,
      pan: 0.3,
      reverb: 0.32,
      pattern: { kind: "arp", low: 52, steps: "1 5 8 5 10 5", ring: 2 },
    },
    tune: { inst: "kantele", gain: 0.5, pan: 0.2, reverb: 0.32 },
    drone: { inst: "drone", gain: 0.55, pan: 0, reverb: 0.25, pattern: { kind: "drone", notes: [40, 47] } },
    cello: { inst: "cello", gain: 0.42, pan: 0.1, reverb: 0.25, pattern: { kind: "arp", low: 36, steps: "1 . . . . ." } },
    stomp: { inst: "perc", gain: 0.39, pan: 0, reverb: 0.3, pattern: { kind: "drum", steps: "S...s.", hits: { S: ["stomp", 0.7], s: ["stomp", 0.45] } } },
  },
  sections: {
    intro: { bars: 2, chords: "Em | Em" },
    A: {
      bars: 8,
      chords: "Em | Em | D | Bm | C | Am | B7 | Em",
      lines: {
        mel: `E2 B2 e2 | g/f/e/f/ g2 e2 | f/e/d/e/ f2 d2 | B/c/d/B/ A2 F2 |
              G2 E2 c2 | B/A/G/F/ E2 A2 | ^D2 F2 B2 | E4 z2`,
      },
    },
    B: {
      bars: 8,
      chords: "G | D | C | D | Em | Am | B7 | Em",
      lines: {
        mel: `d2 g2 b2 | a/g/f/g/ a2 f2 | g/f/e/f/ g2 e2 | f/e/d/e/ f2 d2 |
              e/d/B/d/ e2 B2 | c/B/A/B/ c2 e2 | f/e/^d/e/ f2 B2 | e4 z2`,
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "drone stomp", dyn: 0.6 },
      { s: "A", play: "mel:fiddle drone stomp", dyn: 0.66 },
      { s: "A", play: "mel:fiddle kantele cello stomp", dyn: 0.7 },
      { s: "B", play: "mel:fiddle kantele cello stomp", dyn: 0.72 },
      { s: "B", play: "mel:fiddle mel:tune kantele cello drone stomp", dyn: 0.76, rit: 0.9 },
    ],
    [
      { s: "A", play: "mel:tune drone", dyn: 0.6 },
      { s: "A", play: "mel:fiddle kantele cello stomp", dyn: 0.68 },
      { s: "B", play: "mel:fiddle kantele cello stomp", dyn: 0.72 },
      { s: "B", play: "mel:fiddle mel:tune-12 kantele cello drone stomp", dyn: 0.76, rit: 0.9 },
    ],
  ],
  rest: [10, 18],
};
