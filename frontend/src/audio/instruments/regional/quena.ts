// 盖那笛（安第斯的缺口竖笛）：气声亮、揉音明显（!vib!），像山风里的人声；音头常从下面滑上来（!bend!）。
import type { RegionalDef } from "./types";

export const QUENA: RegionalDef = {
  key: "quena",
  region: "andes",
  name: { zh: "盖那笛", en: "Quena" },
  instrument: {
    kind: "wind",
    amps: (n) => [1, 0.35, 0.18, 0.08, 0.04][n - 1] ?? 0,
    attack: 0.04,
    release: 0.1,
    vib: { rate: 5.4, depth: 16, delay: 0.3 },
    vibBoost: 2,
    breath: { level: 0.17, q: 0.8, ratio: 1.8 },
    pulse: { level: 0.14, q: 1.1, ratio: 2.6 },
    puff: { level: 0.18, decay: 0.07 },
    drift: 5,
    chiff: 0.08,
    tongue: 0.45,
    glide: 0.03,
    blare: { from: 1800, to: 5500, time: 0.2 },
    level: 0.22,
  },
  demo: { key: "A minor", qpm: 96, bars: 4, abc: "e2 {f}e d c2 A2 | !vib!G6 A2 | c2 d e !bend!g4 | !vib!e8" },
};
