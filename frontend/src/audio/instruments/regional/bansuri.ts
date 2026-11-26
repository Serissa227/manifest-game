// 班苏里（印度的竹笛）：暖、气声多，长音上的揉音（!vib!）与滑音（meend，!bend!）是它的说话方式。
import type { RegionalDef } from "./types";

export const BANSURI: RegionalDef = {
  key: "bansuri",
  region: "india",
  name: { zh: "班苏里", en: "Bansuri" },
  instrument: {
    kind: "wind",
    amps: (n) => [1, 0.3, 0.12, 0.06, 0.03][n - 1] ?? 0,
    attack: 0.07,
    release: 0.14,
    vib: { rate: 5.2, depth: 10, delay: 0.35 },
    vibBoost: 2.6,
    breath: { level: 0.16, q: 0.8, ratio: 1.6 },
    pulse: { level: 0.1, q: 1.1, ratio: 2.4 },
    puff: { level: 0.12, decay: 0.08 },
    drift: 5,
    chiff: 0.05,
    tongue: 0.7,
    glide: 0.07,
    blare: { from: 1500, to: 4000, time: 0.3 },
    level: 0.23,
  },
  demo: { key: "D mixolydian", qpm: 66, bars: 3, abc: "!bend!A4 (B2 A2) | !vib!F6 E2 | (D2 E) F !fall!A4" },
};
