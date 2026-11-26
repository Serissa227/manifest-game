// 祖马里（斯瓦希里海岸的双簧管，从阿拉伯与印度洋传来）：响亮、带鼻音，比祖尔纳圆一点；婚礼与节庆的队伍里领着鼓。
import { reedAmps } from "./shape";
import type { RegionalDef } from "./types";

export const ZUMARI: RegionalDef = {
  key: "zumari",
  region: "swahili",
  name: { zh: "祖马里", en: "Zumari" },
  instrument: {
    kind: "wind",
    amps: reedAmps(0.36, [[1300, 0.5, 0.8], [2700, 0.5, 0.5]], 7500),
    attack: 0.03,
    release: 0.08,
    vib: { rate: 5.6, depth: 11, delay: 0.3 },
    breath: { level: 0.025, q: 0.8, ratio: 3 },
    pulse: { level: 0.08, q: 0.9, ratio: 4 },
    chiff: 0.04,
    tongue: 0.5,
    glide: 0.05,
    drift: 6,
    blare: { from: 2000, to: 7000, time: 0.15 },
    level: 0.28,
  },
  demo: { key: "F lydian", qpm: 100, bars: 3, abc: "!bend!c4 d2 c2 | B2 A G !vib!A4 | G F E2 !fall!F4" },
};
