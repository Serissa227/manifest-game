// 谢赫奈（印度的双簧管）：比唢呐甜、鼻音重，长音上的滑音（meend）与揉音很深——婚礼、清晨与庙宇的乐器。
import { reedAmps } from "./shape";
import type { RegionalDef } from "./types";

export const SHEHNAI: RegionalDef = {
  key: "shehnai",
  region: "india",
  name: { zh: "谢赫奈", en: "Shehnai" },
  instrument: {
    kind: "wind",
    amps: reedAmps(0.4, [[1000, 0.45, 0.8], [2200, 0.5, 0.6], [3800, 0.4, 0.2]], 7000),
    attack: 0.04,
    release: 0.1,
    vib: { rate: 5.4, depth: 12, delay: 0.3 },
    vibBoost: 2.4,
    breath: { level: 0.025, q: 0.8, ratio: 3 },
    pulse: { level: 0.07, q: 0.9, ratio: 3.5 },
    chiff: 0.03,
    tongue: 0.65,
    glide: 0.1,
    drift: 5,
    blare: { from: 1800, to: 6000, time: 0.2 },
    level: 0.26,
  },
  demo: { key: "D mixolydian", qpm: 80, bars: 3, abc: "!bend!d4 (c2 B2) | A2 B c !vib!d4 | !bend!B2 A G !fall!A4" },
};
