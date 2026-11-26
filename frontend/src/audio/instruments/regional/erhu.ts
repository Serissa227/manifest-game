// 二胡（明，胡琴一族）：两根弦夹在弓毛里，蟒皮的琴筒鼻音重；揉弦（!vib!）深，音与音之间常常滑过去（写圆滑线），
// 上滑音写 !bend!、下滑音写 !fall!；弓毛的沙声跟着波形一开一合。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const ERHU: RegionalDef = {
  key: "erhu",
  region: "ming",
  name: { zh: "二胡", en: "Erhu" },
  instrument: {
    kind: "bowed",
    amps: (n, f) => (1 / Math.pow(n, 0.75)) * (0.4 + bump(f, 650, 0.45, 0.5) + bump(f, 1150, 0.4, 0.9) + bump(f, 2400, 0.5, 0.55) + bump(f, 3600, 0.4, 0.3)) * roll(f, 6000, 3),
    attack: 0.06,
    release: 0.12,
    vib: { rate: 6.2, depth: 16, delay: 0.18 },
    vibBoost: 2,
    breath: { level: 0.012, q: 0.7, ratio: 6 },
    pulse: { level: 0.08, q: 0.9, ratio: 4 },
    chiff: 0.03,
    tongue: 0.7,
    glide: 0.09,
    drift: 4,
    level: 0.36,
  },
  // D 宫五声：滑过去的连音、揉弦、上滑音
  demo: { key: "D major", qpm: 76, bars: 4, abc: "A3 B A2 F E | (D2 E2) F A !vib!B2 | (d B) (A F) E2 !bend!F2 | !vib!E6 z2" },
};
