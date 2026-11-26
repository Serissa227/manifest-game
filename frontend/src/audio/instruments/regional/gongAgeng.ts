// 大锣（爪哇甘美兰的 gong ageng）：很低的“嗡——”，软槌，起音慢慢绽开，分音近乎谐和，两三赫兹的拍音一涨一落，余音很长；
// 一个循环（gongan）的最后一拍由它收。旋律行里写很低的一个音（E1 一带）。
import type { RegionalDef } from "./types";

export const GONG_AGENG: RegionalDef = {
  key: "gong_ageng",
  region: "nusantara",
  name: { zh: "大锣（甘美兰）", en: "Gong ageng" },
  instrument: {
    kind: "mallet",
    spec: { partials: [[1, 1, 9], [2.0, 0.8, 6], [2.98, 0.6, 4.5], [4.08, 0.45, 3], [5.2, 0.3, 2], [6.4, 0.18, 1.4], [8.1, 0.1, 0.9]], attack: 0.02, strike: [0.2, 0.03, 600], beat: 2.2, tilt: 0.1, max: 9 },
    level: 0.38,
    release: 4,
  },
  demo: { key: "E phrygian", qpm: 60, bars: 3, abc: "E,,,8- | E,,,8 | z8" },
};
