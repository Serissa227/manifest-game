// 祖尔纳（奥斯曼的军乐与婚礼）：短而粗的双簧管，非常响、尖，户外用；与达乌尔大鼓一起是“祖尔纳 — 达乌尔”。
import { reedAmps } from "./shape";
import type { RegionalDef } from "./types";

export const ZURNA: RegionalDef = {
  key: "zurna",
  region: "ottoman",
  name: { zh: "祖尔纳", en: "Zurna" },
  instrument: {
    kind: "wind",
    amps: reedAmps(0.28, [[1500, 0.45, 0.9], [3100, 0.45, 0.7], [5000, 0.4, 0.3]], 9000),
    attack: 0.025,
    release: 0.07,
    vib: { rate: 6, depth: 10, delay: 0.3 },
    breath: { level: 0.02, q: 0.8, ratio: 3 },
    pulse: { level: 0.08, q: 0.9, ratio: 4 },
    chiff: 0.05,
    tongue: 0.45,
    glide: 0.04,
    drift: 5,
    blare: { from: 2600, to: 8500, time: 0.1 },
    level: 0.29,
  },
  demo: { key: "A hijaz", qpm: 100, bars: 3, abc: "!bend!e4 f2 e2 | d c B A !vib!c4 | B A G2 !fall!A4" },
};
