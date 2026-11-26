// 肯普尔（爪哇甘美兰，吊着的中锣）：把一个循环再分成几段，“嗡”比大锣短、高。
import type { RegionalDef } from "./types";

export const KEMPUL: RegionalDef = {
  key: "kempul",
  region: "nusantara",
  name: { zh: "肯普尔", en: "Kempul" },
  instrument: {
    kind: "mallet",
    spec: { partials: [[1, 1, 4], [2.02, 0.45, 2.5], [2.95, 0.3, 1.8], [4.2, 0.2, 1.2]], attack: 0.006, strike: [0.15, 0.015, 1200], beat: 3, tilt: 0.15, max: 4.5 },
    level: 0.55,
    release: 2.5,
  },
  demo: { key: "E phrygian", qpm: 72, bars: 3, abc: "B,,4 z4 | G,,4 z4 | E,,8" },
};
