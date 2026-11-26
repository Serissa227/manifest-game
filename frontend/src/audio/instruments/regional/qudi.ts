// 曲笛（明，昆曲的笛子，南方的低音笛）：比梆笛（bangdi）低四五度、粗、圆、柔，笛膜的“沙”轻一些；
// 昆曲里跟着唱腔走，装饰极多——叠音、打音、赠音写倚音，上滑写 !bend!，长音慢慢揉开（!vib!）。江南丝竹与灯会的细乐也用它。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const QUDI: RegionalDef = {
  key: "qudi",
  region: "ming",
  name: { zh: "曲笛", en: "Qudi" },
  instrument: {
    kind: "wind",
    amps: (n, f) => ((n === 1 ? 1 : 0.5 / Math.pow(n, 0.9)) + bump(f, 2600, 0.5, 0.28) + bump(f, 4200, 0.4, 0.14)) * roll(f, 7000),
    attack: 0.03,
    release: 0.09,
    vib: { rate: 5.2, depth: 12, delay: 0.3 },
    vibBoost: 2.2,
    breath: { level: 0.07, q: 1, ratio: 2 },
    pulse: { level: 0.18, q: 1.4, ratio: 4 },
    puff: { level: 0.06, decay: 0.06 },
    tremor: { rate: 0.8, depth: 0.06 },
    drift: 4,
    chiff: 0.08,
    tongue: 0.62,
    glide: 0.05,
    level: 0.26,
  },
  // 昆腔一样的一句：叠音、赠音、上滑、慢揉
  demo: { key: "D major", qpm: 72, bars: 3, abc: "a2 {b}a f e2 {f}e d | !bend!f3 e d2 B2 | {e}d2 e f !vib!a4" },
};
