// 《香料之路》：卡迪尔苏丹国的港口（沙漠风）。D 上的巴亚提木卡姆（第二级 E 降四分之一音），
// 4/4 拍的马克苏姆节奏（咚 嗒 · 嗒 咚 · 嗒 ·），乌德琴与奈伊笛轮流领奏，底下是 D 与 A 的持续音；
// B 段转到 D 上的希贾兹（降 E、升 F 的增二度），再回到巴亚提。
import type { TrackDef } from "../score";

export const DESERT: TrackDef = {
  id: "port_desert",
  title: { zh: "香料之路", en: "The Spice Road" },
  qpm: 92,
  meter: [4, 4],
  key: "D bayati",
  voices: {
    oud: { inst: "oud", gain: 0.8, pan: -0.15, reverb: 0.25 },
    ney: { inst: "ney", gain: 0.55, pan: 0.2, reverb: 0.35 },
    qanun: { inst: "zheng", gain: 0.26, pan: 0.35, reverb: 0.3, pattern: { kind: "arp", low: 50, steps: "1 5 8 5 12 8 5 8", ring: 2 } },
    drone: { inst: "drone", gain: 0.45, reverb: 0.25, pattern: { kind: "drone", notes: [50, 57] } },
    bass: { inst: "pizz", gain: 0.45, pan: 0.05, reverb: 0.15, pattern: { kind: "arp", low: 38, steps: "1 . . . 1 . . .", ring: 2 } },
    darbuka: {
      inst: "perc",
      gain: 0.2,
      pan: 0.1,
      reverb: 0.2,
      pattern: {
        a: { kind: "drum", steps: "DT.TD.T.", hits: { D: ["doum", 0.8], T: ["tek", 0.5] } },
        b: { kind: "drum", steps: "DTkTD.Tk", hits: { D: ["doum", 0.8], T: ["tek", 0.5], k: ["ka", 0.3] } },
      },
    },
    riq: { inst: "perc", gain: 0.56, pan: -0.3, reverb: 0.2, pattern: { kind: "drum", steps: ".r.r.rr.", hits: { r: ["riq", 0.4] } } },
  },
  sections: {
    intro: { bars: 2, chords: "D5 | D5" },
    A: {
      bars: 8,
      chords: "D5 | D5 | D5 | D5 | D5 | D5 | D5 | D5",
      lines: {
        mel: `!slide!D2 E F G2 F E | F2 G A G F E D | E2 F G A2 B A | {A}G4 F2 E2 |
              A2 B c d2 c B | A2 G F G2 A G | F2 E D E2 F E | {E}D6 z2`,
      },
    },
    B: {
      bars: 8,
      chords: "D5 | D5 | G5 | G5 | D5 | D5 | D5 | D5",
      lines: {
        mel: `A2 B A G2 ^F _E | ^F4 G2 A2 | B2 c B A2 G ^F | G4 ^F2 _E2 |
              D2 _E ^F G2 A B | c2 B A B2 A G | ^F2 G ^F _E2 D _E | D6 z2`,
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "drone darbuka", dyn: 0.62 },
      { s: "A", play: "mel:oud drone bass darbuka", dyn: 0.66 },
      { s: "A", play: "mel:ney drone bass darbuka riq", dyn: 0.68 },
      { s: "B", play: "mel:oud mel:ney qanun drone bass darbuka.b riq", dyn: 0.74 },
      { s: "A", play: "mel:oud mel:ney drone bass darbuka riq", dyn: 0.72, rit: 0.9 },
    ],
    [
      { s: "A", play: "mel:ney drone", dyn: 0.6 },
      { s: "A", play: "mel:oud drone bass darbuka", dyn: 0.68 },
      { s: "B", play: "mel:oud qanun drone bass darbuka.b riq", dyn: 0.72 },
      { s: "A", play: "mel:ney mel:oud-12 drone bass darbuka riq", dyn: 0.72, rit: 0.9 },
    ],
  ],
  rest: [10, 20],
};
