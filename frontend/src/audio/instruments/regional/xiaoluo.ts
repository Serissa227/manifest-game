// 小锣（明，锣鼓里的“台”）：敲下去以后音高往上翘约两个半音，亮、短。旋律行里写一个固定的音（F5 一带）。
import type { RegionalDef } from "./types";

export const XIAOLUO: RegionalDef = {
  key: "xiaoluo",
  region: "ming",
  name: { zh: "小锣", en: "Small gong (xiaoluo)" },
  instrument: {
    kind: "mallet",
    spec: {
      partials: [[1, 1, 1.1], [2.04, 0.4, 0.6], [2.9, 0.35, 0.45], [4.1, 0.25, 0.3], [5.5, 0.15, 0.2], [6.8, 0.08, 0.15], [8.3, 0.05, 0.1]],
      attack: 0.001,
      strike: [0.25, 0.006, 6000],
      beat: 2,
      tilt: 0.1,
      glide: { from: 0.86, time: 0.09 },
      max: 2.2,
    },
    level: 1.02,
    release: 1.2,
  },
  demo: { key: "C major", qpm: 96, bars: 3, abc: "f2 z2 f2 z f | f4 z4 | f z f z f2 z2" },
};
