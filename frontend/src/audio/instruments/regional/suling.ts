// 苏灵笛（爪哇与马来的环吹竹笛）：轻、飘，气声多，在甘美兰上方自由地飘，装饰多。
import type { RegionalDef } from "./types";

export const SULING: RegionalDef = {
  key: "suling",
  region: "nusantara",
  name: { zh: "苏灵笛", en: "Suling" },
  instrument: {
    kind: "wind",
    amps: (n) => [1, 0.2, 0.1, 0.04][n - 1] ?? 0,
    attack: 0.05,
    release: 0.12,
    vib: { rate: 5.5, depth: 14, delay: 0.3 },
    breath: { level: 0.14, q: 0.9, ratio: 1.6 },
    pulse: { level: 0.08, q: 1.2, ratio: 2.4 },
    puff: { level: 0.1, decay: 0.06 },
    drift: 5,
    chiff: 0.06,
    tongue: 0.6,
    glide: 0.05,
    level: 0.24,
  },
  demo: { key: "E phrygian", qpm: 70, bars: 3, abc: "e4 {f}e2 c2 | !vib!B6 G2 | F G B !bend!c4 !vib!B" },
};
