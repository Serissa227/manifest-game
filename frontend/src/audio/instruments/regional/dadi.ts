// 大笛（明，南方丝竹与民间细乐里的低音笛子，曲笛一族里最低的一支）：比曲笛（qudi）再低四五度，粗、暗、气多，笛膜只轻轻地“沙”；
// 夜里慢的段落、灯下的细乐用它。装饰与曲笛相同：倚音、上滑（!bend!）、慢揉（!vib!）。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const DADI: RegionalDef = {
  key: "dadi",
  region: "ming",
  name: { zh: "大笛", en: "Dadi" },
  instrument: {
    kind: "wind",
    amps: (n, f) => ((n === 1 ? 1 : 0.42 / n) + bump(f, 2000, 0.5, 0.22) + bump(f, 3600, 0.4, 0.1)) * roll(f, 6000),
    attack: 0.04,
    release: 0.12,
    vib: { rate: 4.9, depth: 13, delay: 0.35 },
    vibBoost: 2.4,
    breath: { level: 0.1, q: 0.9, ratio: 1.8 },
    pulse: { level: 0.14, q: 1.3, ratio: 4 },
    puff: { level: 0.08, decay: 0.08 },
    tremor: { rate: 0.7, depth: 0.08 },
    drift: 5,
    chiff: 0.06,
    tongue: 0.68,
    glide: 0.06,
    level: 0.27,
  },
  // 夜里的一句：低音区的长音、上滑、慢揉
  demo: { key: "D major", qpm: 66, bars: 3, abc: "!bend!D4 E2 F2 | A3 {d}B A2 F2 | !vib!E4 !vib!D4" },
};
