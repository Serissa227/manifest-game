// 竹笛（sáo trúc，大越的横吹竹笛）：比梆笛柔、没有笛膜的“沙”，气声清，装饰是快的倚音（láy）与句尾的滑落。
import type { RegionalDef } from "./types";

export const SAO_TRUC: RegionalDef = {
  key: "sao_truc",
  region: "vietnam",
  name: { zh: "竹笛（越南）", en: "Sáo trúc" },
  instrument: {
    kind: "wind",
    amps: (n) => [1, 0.28, 0.12, 0.06, 0.03][n - 1] ?? 0,
    attack: 0.05,
    release: 0.11,
    vib: { rate: 5.8, depth: 15, delay: 0.25 },
    vibBoost: 2,
    breath: { level: 0.12, q: 0.9, ratio: 1.6 },
    pulse: { level: 0.07, q: 1.2, ratio: 2.6 },
    puff: { level: 0.07, decay: 0.05 },
    drift: 4,
    chiff: 0.07,
    tongue: 0.55,
    glide: 0.05,
    level: 0.25,
  },
  demo: { key: "C major", qpm: 80, bars: 3, abc: "g2 {a}g f d2 c d | !bend!f4 !vib!g4 | a g f d !fall!c4" },
};
