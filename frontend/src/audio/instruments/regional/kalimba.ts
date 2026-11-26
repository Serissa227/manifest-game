// 拇指琴（斯瓦希里海岸到内陆的姆比拉、利肯贝）：拇指拨铁片，铁片的分音不成倍数，琴上的铁环与瓶盖跟着“沙沙”响；
// 两只拇指交替拨出咬合的短句，一圈圈地转。
import type { RegionalDef } from "./types";

export const KALIMBA: RegionalDef = {
  key: "kalimba",
  region: "swahili",
  name: { zh: "拇指琴", en: "Thumb piano" },
  instrument: {
    kind: "mallet",
    spec: {
      partials: [[1, 1, 1.6], [5.4, 0.16, 0.25], [6.27, 0.1, 0.18], [12.1, 0.03, 0.05]],
      attack: 0.0015,
      strike: [0.15, 0.003, 5000],
      tilt: 0.35,
      rattle: { level: 0.35, lo: 2500, hi: 8000, gate: 0.08 },
      max: 2.5,
    },
    level: 0.95,
    release: 0.8,
  },
  demo: { key: "F lydian", qpm: 110, bars: 4, abc: "F A c A d c A c | G B d B e d B d | F A c A d c A c | [Fc]4 z4" },
};
