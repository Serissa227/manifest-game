// 《瑶华季风》：东方海域（瑶华海、云屿海）。D 宫五声调式（D E 升F A B），6/8 拍，像季风推着帆：
// 筝弹流动的分解和弦，低音拨奏落在第一、四拍，梆子与木鱼“嗒 · · 笃 · ·”；笙（用持续音的音色）托着长音。
// 开头筝一串上行的刮奏、一声锣，笛子吹起帆动机（A → D → A，高八度）；A 段笛子领奏（带倚音与上滑音），
// B 段由筝弹旋律、笛子接着在上面吹；与港口曲《琉璃瓦上的月》（G 宫、慢 4/4）同一种风味，律动是航海曲的 6/8。
import type { TrackDef } from "../score";

export const SEA_EAST: TrackDef = {
  id: "sea_east",
  title: { zh: "瑶华季风", en: "Yaohua Monsoon" },
  qpm: 96,
  meter: [6, 8],
  key: "D major",
  voices: {
    dizi: { inst: "dizi", gain: 0.72, pan: -0.12, reverb: 0.4 },
    zheng: { inst: "zheng", gain: 0.46, pan: 0.2, reverb: 0.38 },
    arp: { inst: "zheng", gain: 0.26, pan: 0.3, reverb: 0.4, pattern: { kind: "arp", low: 50, steps: "1 5 8 10 12 10", ring: 3 } },
    sheng: { inst: "drone", gain: 0.52, pan: -0.25, reverb: 0.4, pattern: { kind: "pad", low: 62, high: 79, size: 3 } },
    bass: { inst: "pizz", gain: 0.5, pan: 0.05, reverb: 0.15, pattern: { kind: "arp", low: 38, steps: "1 . . 5, . .", ring: 2 } },
    gong: { inst: "gong", gain: 0.36, pan: 0.1, reverb: 0.6 },
    clapper: { inst: "perc", gain: 0.3, pan: -0.2, reverb: 0.3, pattern: { kind: "drum", steps: "c..w..", hits: { c: ["clapper", 0.4], w: ["woodblock", 0.3] } } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "D6 | Asus4 | D6 | D6",
      lines: {
        // 筝的上行刮奏（五声音阶）
        gliss: "D/4E/4F/4A/4B/4d/4e/4f/4 z4 | z6 | z6 | z6",
        gong: "D,,6 | z6 | z6 | z6",
        motif: "z6 | z4 A3/2 d/2 | a6 | z6",
      },
    },
    A: {
      bars: 8,
      chords: "D6 | Bm7 | Em7 | Asus4 | D6 | Bm7 | Asus4 | D6",
      lines: {
        mel: "f3 a2 b | a3 f3 | e3 f2 a | !slide!a6 | d'3 e'2 d' | b3 a2 f | e3 f2 e | d6",
        mel2: "{g}f3 a2 b | a3 {b}f3 | e3 f2 a | !slide!a6 | d'3 e'2 d' | {c'}b3 a2 f | e3 f2 e | d6",
      },
    },
    B: {
      bars: 8,
      chords: "Bm7 | Em7 | D6 | Bm7 | Em7 | Asus4 | Bm7 | D6",
      lines: {
        mel: "d3 f2 e | e3 d2 B | A3 B2 d | !slide!B6 | e3 f2 a | a3 f2 e | d3 B2 A | d6",
        gong: "B,,6 | z6 | z6 | z6 | z6 | z6 | z6 | z6",
      },
    },
    outro: {
      bars: 4,
      chords: "Bm7 | Asus4 | D6 | D6",
      lines: {
        tag: "d3 B2 A | e3 f2 e | d6 | z6",
        gong: "z6 | z6 | D,,6 | z6",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "gliss:zheng gong:gong motif:dizi arp sheng", dyn: 0.56, to: 0.62 },
      { s: "A", play: "mel:dizi arp bass clapper", dyn: 0.62 },
      { s: "A", play: "mel2:dizi mel:zheng-12 arp sheng bass clapper", dyn: 0.66 },
      { s: "B", play: "mel:zheng gong:gong arp sheng bass clapper", dyn: 0.64 },
      { s: "B", play: "mel:dizi mel:zheng-12 arp sheng bass clapper", dyn: 0.68 },
      { s: "A", play: "mel2:dizi arp sheng bass clapper", dyn: 0.7 },
      { s: "outro", play: "tag:dizi gong:gong arp sheng", dyn: 0.58, to: 0.38, rit: 0.85 },
    ],
    [
      { s: "intro", play: "gliss:zheng gong:gong arp", dyn: 0.54, to: 0.6 },
      { s: "A", play: "mel:zheng-12 arp bass", dyn: 0.6 },
      { s: "A", play: "mel:dizi arp sheng bass clapper", dyn: 0.64 },
      { s: "B", play: "mel:dizi gong:gong arp sheng bass clapper", dyn: 0.66 },
      { s: "B", play: "mel:zheng arp sheng bass clapper", dyn: 0.66 },
      { s: "A", play: "mel2:dizi mel:zheng-12 arp sheng bass clapper", dyn: 0.7 },
      { s: "outro", play: "tag:dizi gong:gong arp sheng", dyn: 0.56, to: 0.36, rit: 0.85 },
    ],
  ],
  rest: [25, 45],
};
