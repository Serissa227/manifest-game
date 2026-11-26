// 海螺号（玛雅与中美洲）：吹大海螺，低、粗、带着嘶的长音，音头从下面推上来（!bend!）——祭礼与开市的号角。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const CONCH: RegionalDef = {
  key: "conch",
  region: "maya",
  name: { zh: "海螺号", en: "Conch trumpet" },
  instrument: {
    kind: "brass",
    amps: (n, f) => (1 / Math.pow(n, 0.6)) * (0.6 + bump(f, 900, 0.5, 0.5)) * roll(f, 2600, 2.5),
    attack: 0.15,
    release: 0.3,
    vib: { rate: 4, depth: 8, delay: 0.5 },
    breath: { level: 0.06, q: 0.8, ratio: 2 },
    pulse: { level: 0.1, q: 0.9, ratio: 4 },
    drift: 10,
    tongue: 0.5,
    glide: 0.1,
    blare: { from: 700, to: 2600, time: 0.4 },
    level: 0.33,
  },
  demo: { key: "G minor", qpm: 70, bars: 3, abc: "!bend!G,6 z2 | !bend!G,2 z2 !bend!D4 | !fall!G,8" },
};
