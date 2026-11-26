// 拍板（明，昆曲与南音的“板”）：几片硬木板用绳串着，一合“啪”——板片不是同时碰上的，所以是又亮又脆的两三下连在一起；
// 一板一眼里的“板”（强拍）由它打，司鼓一手板鼓一手拍板。比通用的梆子（clapper）低一点、更“散”，带木头的共鸣。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const PAIBAN: RegionalDef = {
  region: "ming",
  name: { zh: "拍板", en: "Paiban" },
  drums: {
    paiban: {
      layers: [
        skin(1650, 1620, 0.006, 0.07, 0.8, [[1.42, 0.5, 0.05], [2.31, 0.35, 0.035]], 0.0005),
        skin(2900, 2850, 0.005, 0.04, 0.4, undefined, 0.0005),
        hiss(2200, 10000, 0.012, 0.7, { attack: 0.001, taps: 2 }),
      ],
    },
  },
  // 一板三眼：板落在每小节的头上
  demo: { key: "C major", qpm: 72, bars: 3, drum: [{ steps: "P.......P.......P...P...", hits: { P: ["paiban", 0.85] } }] },
};
