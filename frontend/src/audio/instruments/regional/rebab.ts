// 雷巴布（爪哇与马来的两弦胡琴）：椰壳或木头的琴筒蒙着薄皮，坐着竖拉；声音暗、鼻音重，在甘美兰里引子与装饰都给它。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const REBAB: RegionalDef = {
  key: "rebab",
  region: "nusantara",
  name: { zh: "雷巴布", en: "Rebab" },
  instrument: {
    kind: "bowed",
    amps: (n, f) => (1 / Math.pow(n, 0.85)) * (0.4 + bump(f, 550, 0.45, 0.6) + bump(f, 1000, 0.4, 0.7) + bump(f, 2000, 0.5, 0.35)) * roll(f, 4500, 3),
    attack: 0.07,
    release: 0.14,
    vib: { rate: 5.4, depth: 14, delay: 0.25 },
    vibBoost: 2,
    breath: { level: 0.014, q: 0.7, ratio: 5 },
    pulse: { level: 0.09, q: 0.9, ratio: 3.5 },
    chiff: 0.025,
    tongue: 0.7,
    glide: 0.1,
    drift: 5,
    level: 0.31,
  },
  demo: { key: "E phrygian", qpm: 70, bars: 3, abc: "B2 c2 !bend!e4 | !vib!c6 B2 | (G F) E2 !fall!F4" },
};
