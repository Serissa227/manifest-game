// 唢呐（明）：双簧的哨片接着铜碗，响亮、明亮、带“喊”的颜色，街头与喜事的乐器；滑音（!bend! !fall!）与倚音很多。
import { reedAmps } from "./shape";
import type { RegionalDef } from "./types";

export const SUONA: RegionalDef = {
  key: "suona",
  region: "ming",
  name: { zh: "唢呐", en: "Suona" },
  instrument: {
    kind: "wind",
    amps: reedAmps(0.32, [[1250, 0.5, 0.8], [2800, 0.5, 0.6], [4500, 0.4, 0.25]], 8000),
    attack: 0.03,
    release: 0.08,
    vib: { rate: 5.8, depth: 12, delay: 0.3 },
    vibBoost: 2,
    breath: { level: 0.02, q: 0.8, ratio: 3 },
    pulse: { level: 0.07, q: 0.9, ratio: 4 },
    chiff: 0.05,
    tongue: 0.5,
    glide: 0.05,
    drift: 5,
    blare: { from: 2200, to: 7500, time: 0.12 },
    level: 0.27,
  },
  demo: { key: "D major", qpm: 100, bars: 3, abc: "a2 {b}a2 !bend!f2 e2 | d2 e f a2 b2 | !bend!a4 !fall!f4" },
};
