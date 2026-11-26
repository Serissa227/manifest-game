// 克农（爪哇甘美兰，横放在绳架上的大锅锣）：“侬——”，标出循环里的几个大拍。
import type { RegionalDef } from "./types";

export const KENONG: RegionalDef = {
  key: "kenong",
  region: "nusantara",
  name: { zh: "克农", en: "Kenong" },
  instrument: {
    kind: "mallet",
    spec: { partials: [[1, 1, 2.2], [2.5, 0.25, 0.8], [3.9, 0.1, 0.4]], attack: 0.004, strike: [0.12, 0.01, 1500], beat: 2.5, tilt: 0.2, max: 3 },
    level: 0.52,
    release: 1.5,
  },
  demo: { key: "E phrygian", qpm: 72, bars: 3, abc: "z4 B4 | z4 c4 | z4 e4" },
};
