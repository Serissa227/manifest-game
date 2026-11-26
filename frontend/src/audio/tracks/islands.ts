// 《珊瑚潮》：马纳瓦群岛议会的港口（群岛风）。C 大调五声旋律，4/4 拍，悠闲，
// 鼻笛领奏（句中有切分），四弦小吉他扫出“下 · 下上 · 上下上”的节奏，木琴在重复时走下方三度；
// 大鼓落在第一、三拍，沙锤走八分音符，B 段加上木鼓的十六分音符花样。
import type { TrackDef } from "../score";

export const ISLANDS: TrackDef = {
  id: "port_islands",
  title: { zh: "珊瑚潮", en: "Coral Tide" },
  qpm: 92,
  meter: [4, 4],
  key: "C major",
  voices: {
    vivo: { inst: "vivo", gain: 0.62, pan: -0.15, reverb: 0.32 },
    marimba: { inst: "marimba", gain: 0.72, pan: 0.25, reverb: 0.28 },
    uke: { inst: "ukulele", gain: 0.26, pan: 0.3, reverb: 0.2, pattern: { kind: "strum", low: 60, high: 76, steps: "D . D U . U D U", spread: 0.009 } },
    bass: { inst: "pizz", gain: 0.46, pan: 0, reverb: 0.15, pattern: { kind: "arp", low: 36, steps: "1 . . . 5, . . .", ring: 3 } },
    pahu: { inst: "perc", gain: 0.18, pan: 0.05, reverb: 0.25, pattern: { kind: "drum", steps: "P...p...", hits: { P: ["pahu", 0.8], p: ["pahu", 0.45] } } },
    shaker: { inst: "perc", gain: 0.64, pan: -0.35, reverb: 0.15, pattern: { kind: "drum", steps: "sSsSsSsS", hits: { s: ["shaker", 0.35], S: ["shaker", 0.55] } } },
    logs: {
      inst: "perc",
      gain: 0.64,
      pan: 0.4,
      reverb: 0.2,
      pattern: { kind: "drum", grid: 0.5, steps: "X.xx.x.xX.xx.xx.", hits: { X: ["woodblock", 0.55], x: ["woodblock", 0.3] } },
    },
  },
  sections: {
    intro: { bars: 2, chords: "C | G" },
    A: {
      bars: 8,
      chords: "C | Am | G | C | C | F | G | C",
      lines: {
        mel: `E2 G A- A2 G2 | A3 G E2 D2 | D2 E2 G2 E2 | C6 z2 |
              E2 G c- c2 A2 | c3 A G2 A2 | G2 E2 D2 E2 | C6 z2`,
      },
    },
    B: {
      bars: 8,
      chords: "F | C | G | C | F | C | G | C",
      lines: {
        mel: `A2 c2 d2 c2 | c3 A G2 E2 | D2 G2 A2 G2 | E6 z2 |
              A2 c2 d2 e2 | g3 e d2 c2 | d2 c2 A2 G2 | c6 z2`,
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "uke shaker", dyn: 0.6 },
      { s: "A", play: "mel:vivo uke bass pahu shaker", dyn: 0.64 },
      { s: "A", play: "mel:marimba uke bass pahu shaker", dyn: 0.66 },
      { s: "B", play: "mel:vivo uke bass pahu shaker logs", dyn: 0.7 },
      { s: "B", play: "mel:vivo mel:marimba~-2 uke bass pahu shaker logs", dyn: 0.72, rit: 0.92 },
    ],
    [
      { s: "A", play: "mel:marimba uke shaker", dyn: 0.6 },
      { s: "A", play: "mel:vivo mel:marimba~-2 uke bass pahu shaker", dyn: 0.66 },
      { s: "B", play: "mel:vivo uke bass pahu shaker logs", dyn: 0.7 },
      { s: "B", play: "mel:marimba mel:vivo uke bass pahu shaker", dyn: 0.7, rit: 0.92 },
    ],
  ],
  rest: [10, 18],
};
