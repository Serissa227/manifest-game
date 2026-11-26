// 赫奈（hne，缅甸的双簧管）：木管接着一只可以拆下的铜喇叭口，又尖又亮，在露天的 hsaing waing 乐队里压过一切；
// 颤得快（每秒约七下）、句尾常常一抖一落，像在喊。
import { reedAmps } from "./shape";
import type { RegionalDef } from "./types";

export const HNE: RegionalDef = {
  key: "hne",
  region: "burma",
  name: { zh: "赫奈（缅甸双簧管）", en: "Hne" },
  instrument: {
    kind: "wind",
    // 共振峰比唢呐高（1.3、2.9、4.8 kHz），铜喇叭口让它更“尖”；快而深的颤
    amps: reedAmps(0.3, [[1300, 0.5, 0.85], [2900, 0.45, 0.65], [4800, 0.4, 0.3]], 8500),
    attack: 0.025,
    release: 0.07,
    vib: { rate: 7, depth: 18, delay: 0.22 },
    vibBoost: 2,
    breath: { level: 0.02, q: 0.8, ratio: 3 },
    pulse: { level: 0.075, q: 0.9, ratio: 4 },
    chiff: 0.05,
    tongue: 0.6,
    glide: 0.06,
    drift: 6,
    blare: { from: 2400, to: 8000, time: 0.1 },
    level: 0.3,
  },
  demo: { key: "C major", qpm: 96, bars: 3, abc: "{d}c2 !bend!e2 g2 {a}g e | !vib!d4 c A G2 | !bend!c4 !fall!A4" },
};
