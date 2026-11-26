// 大锣（明，锣鼓里的“匡”）：敲下去以后音高往下沉，分音多、拖着一片金属的“哗”。旋律行里写一个固定的音（G3 一带）。
import type { RegionalDef } from "./types";

export const DALUO: RegionalDef = {
  key: "daluo",
  region: "ming",
  name: { zh: "大锣", en: "Large gong (daluo)" },
  instrument: {
    kind: "mallet",
    spec: {
      partials: [[1, 1, 2.2], [1.48, 0.6, 1.7], [2.15, 0.55, 1.4], [2.8, 0.45, 1.1], [3.6, 0.4, 0.9], [4.7, 0.35, 0.7], [6.1, 0.3, 0.55], [7.4, 0.25, 0.45], [9.2, 0.2, 0.35], [11.3, 0.15, 0.25]],
      attack: 0.002,
      strike: [0.5, 0.012, 5000],
      rattle: { level: 0.25, lo: 2000, hi: 7000, gate: 0.04 },
      beat: 1.2,
      tilt: 0.1,
      glide: { from: 1.07, time: 0.3 },
      max: 3.5,
    },
    level: 0.87,
    release: 2,
  },
  demo: { key: "C major", qpm: 90, bars: 3, abc: "G,4 z4 | z4 G,2 z2 | G,8" },
};
