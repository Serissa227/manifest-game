// 《琉璃瓦上的月》：瑶华帝国的港口（东方风）。G 宫五声调式，慢 4/4，
// 开头古筝一串上行的刮奏、一声小锣；笛子领奏，带倚音与上滑音，古筝弹流动的分解和弦，笙在后面托着长音；
// B 段落在羽音（E）上，像一句没有说完的话，再回到宫音。
import type { TrackDef } from "../score";

export const EASTERN: TrackDef = {
  id: "port_eastern",
  title: { zh: "琉璃瓦上的月", en: "Moon over the Glazed Tiles" },
  qpm: 72,
  meter: [4, 4],
  key: "G major",
  voices: {
    dizi: { inst: "dizi", gain: 0.66, pan: -0.12, reverb: 0.4 },
    zheng: { inst: "zheng", gain: 0.55, pan: 0.2, reverb: 0.38 },
    arp: { inst: "zheng", gain: 0.32, pan: 0.3, reverb: 0.4, pattern: { kind: "arp", low: 43, steps: "1 5 8 10 12 10 8 5", ring: 3 } },
    sheng: { inst: "drone", gain: 0.39, pan: -0.25, reverb: 0.4, pattern: { kind: "pad", low: 62, high: 79, size: 3 } },
    gong: { inst: "gong", gain: 0.4, pan: 0.1, reverb: 0.6 },
    clapper: { inst: "perc", gain: 0.24, pan: -0.2, reverb: 0.35, pattern: { kind: "drum", steps: "c.......c...c...", hits: { c: ["clapper", 0.4] } } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "G6 | Dsus4",
      lines: {
        // 古筝上行刮奏（两个八度的五声音阶）
        gliss: "G,//A,//B,//D// E//G//A//B// d//e//g//a// b//d'//e'//g'// z4 | z8",
        gong: "G,,4 z4 | z8",
      },
    },
    A: {
      bars: 8,
      chords: "G6 | Em7 | Em7 | Dsus4 | G6 | Em7 | Dsus4 | G6",
      lines: {
        mel: `{e}d3 e d2 B2 | {B}A2 B2 G4 | E2 G2 A2 B2 | !slide!d6 z2 |
              e3 g {a}e2 d2 | B2 d2 {B}A4 | G2 A2 B2 A2 | G6 z2`,
      },
    },
    B: {
      bars: 8,
      chords: "Em7 | G6 | Dsus4 | Em7 | Em7 | G6 | Dsus4 | Em7",
      lines: {
        mel: `g3 a g2 e2 | d2 e2 B4 | A2 B2 d2 e2 | !slide!B6 z2 |
              E2 G2 A2 B2 | {e}d3 e d2 B2 | A2 G2 E2 D2 | E6 z2`,
        gong: "E,,4 z4 | z8 | z8 | z8 | z8 | z8 | z8 | z8",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "gliss:zheng gong:gong arp", dyn: 0.6 },
      { s: "A", play: "mel:dizi arp clapper", dyn: 0.62 },
      { s: "A", play: "mel:zheng sheng clapper", dyn: 0.62 },
      { s: "B", play: "mel:dizi gong:gong arp sheng clapper", dyn: 0.68 },
      { s: "A", play: "mel:dizi mel:zheng-12 sheng clapper", dyn: 0.7, rit: 0.9 },
    ],
    [
      { s: "A", play: "mel:zheng arp", dyn: 0.58 },
      { s: "A", play: "mel:dizi arp sheng clapper", dyn: 0.64 },
      { s: "B", play: "mel:dizi gong:gong arp sheng clapper", dyn: 0.68 },
      { s: "A", play: "mel:dizi mel:zheng-12 arp sheng", dyn: 0.68, rit: 0.9 },
    ],
  ],
  rest: [12, 20],
};
