// 普图图（安第斯的海螺号，印加的驿卒与祭礼吹它；后来也用牛角做）：从海边运上高原的大海螺，吹出来比玛雅的海螺号亮、冲，
// 带着粗的“嘟噜”（嘴唇的颤，一秒二十来下的起伏），音头从下面推上去（!bend!），常只有一两个音。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const PUTUTU: RegionalDef = {
  key: "pututu",
  region: "andes",
  name: { zh: "普图图海螺号", en: "Pututu (Andean conch)" },
  instrument: {
    kind: "brass",
    amps: (n, f) => (1 / Math.pow(n, 0.45)) * (0.5 + bump(f, 1300, 0.6, 0.8) + bump(f, 2600, 0.5, 0.3)) * roll(f, 4200, 2.5),
    attack: 0.12,
    release: 0.28,
    vib: { rate: 4.4, depth: 6, delay: 0.6 },
    breath: { level: 0.07, q: 0.7, ratio: 3 },
    pulse: { level: 0.12, q: 0.9, ratio: 4.5 },
    tremor: { rate: 23, depth: 0.22 },
    drift: 12,
    tongue: 0.5,
    glide: 0.12,
    blare: { from: 900, to: 4500, time: 0.32 },
    level: 0.41,
  },
  demo: { key: "A minor", qpm: 72, bars: 3, abc: "!bend!E,6 z2 | !bend!E,2 z2 !bend!A,4 | !fall!E,8" },
};
