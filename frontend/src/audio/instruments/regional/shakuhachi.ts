// 尺八（日本）：开管的竹笛，气声很重、跟着波形一开一合；起音常有一口冲出来的气（muraiki），长音慢慢鼓起，
// 尾巴揉开（yuri，写 !vib!），meri 的音从下面上来（!bend!），句尾落下去（!fall!）。
import { bump } from "./shape";
import type { RegionalDef } from "./types";

export const SHAKUHACHI: RegionalDef = {
  key: "shakuhachi",
  region: "japan",
  name: { zh: "尺八", en: "Shakuhachi" },
  instrument: {
    kind: "wind",
    amps: (n, f) => ([1, 0.45, 0.2, 0.1, 0.06, 0.03][n - 1] ?? 0) * (1 + bump(f, 1700, 0.6, 0.3)),
    attack: 0.07,
    release: 0.14,
    vib: { rate: 4.4, depth: 10, delay: 0.5 },
    vibBoost: 3.2,
    breath: { level: 0.17, q: 0.8, ratio: 1.5 },
    pulse: { level: 0.14, q: 1.2, ratio: 3 },
    puff: { level: 0.32, decay: 0.12 },
    tremor: { rate: 0.8, depth: 0.14 },
    drift: 6,
    chiff: 0.04,
    tongue: 0.72,
    glide: 0.07,
    blare: { from: 1400, to: 5200, time: 0.28 },
    level: 0.255,
  },
  // 本曲一样的长句：meri 上来、yuri 揉开、倚音、句尾落下
  demo: { key: "D minor", qpm: 72, bars: 3, abc: "!bend!A4 G2 F2 | !vib!G6 z2 | {A}c4 !fall!A4" },
};
