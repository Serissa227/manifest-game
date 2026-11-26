// 箫（明，竖吹的洞箫）：低、柔、气多，像夜里的说话；揉音慢，音头常从下面上来。
import type { RegionalDef } from "./types";

export const XIAO: RegionalDef = {
  key: "xiao",
  region: "ming",
  name: { zh: "箫", en: "Xiao" },
  instrument: {
    kind: "wind",
    amps: (n) => [1, 0.22, 0.09, 0.04, 0.02][n - 1] ?? 0,
    attack: 0.09,
    release: 0.18,
    vib: { rate: 4.6, depth: 9, delay: 0.45 },
    vibBoost: 2.4,
    breath: { level: 0.2, q: 0.8, ratio: 1.4 },
    pulse: { level: 0.1, q: 1.1, ratio: 2.2 },
    puff: { level: 0.1, decay: 0.1 },
    tremor: { rate: 0.7, depth: 0.1 },
    drift: 5,
    chiff: 0.03,
    tongue: 0.75,
    glide: 0.08,
    blare: { from: 1100, to: 3200, time: 0.35 },
    level: 0.23,
  },
  demo: { key: "D minor", qpm: 66, bars: 3, abc: "D4 E2 F2 | !vib!A6 G2 | !bend!F4 !vib!D4" },
};
