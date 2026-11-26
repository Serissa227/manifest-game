// 大笒（대금，朝鲜）：很长的横吹竹笛，吹孔与按孔之间有一个蒙着芦苇膜的孔（청공）——吹响时膜跟着“嗡”（청소리），
// 高音区与吹得重时最响；低音区气多、柔、暗。长音慢慢鼓起来又落下（tremor），尾巴深揉（!vib!），上滑写 !bend!，句尾落下写 !fall!。
// 与明的梆笛不同：更低、气更重，膜的“嗡”在四倍频上，不那么亮。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const DAEGEUM: RegionalDef = {
  key: "daegeum",
  region: "korea",
  name: { zh: "大笒", en: "Daegeum" },
  instrument: {
    kind: "wind",
    amps: (n, f) => ((n === 1 ? 1 : 0.5 / Math.pow(n, 0.8)) + bump(f, 2600, 0.5, 0.35) + bump(f, 4200, 0.4, 0.2)) * roll(f, 8000),
    attack: 0.06,
    release: 0.14,
    vib: { rate: 4.6, depth: 14, delay: 0.4 },
    vibBoost: 3,
    breath: { level: 0.14, q: 0.9, ratio: 1.6 },
    pulse: { level: 0.22, q: 1.4, ratio: 4 },
    puff: { level: 0.18, decay: 0.1 },
    tremor: { rate: 0.55, depth: 0.2 },
    drift: 6,
    chiff: 0.05,
    tongue: 0.7,
    glide: 0.08,
    blare: { from: 1200, to: 4800, time: 0.4 },
    level: 0.27,
  },
  // 长音鼓起来、mi 深揉、la 平、折音、句尾落下
  demo: { key: "A minor", qpm: 66, bars: 3, abc: "!vib!e4 (d c) A2 | (c B3) !vib!E4 | A3 c !bend!d2 !fall!c2" },
};
