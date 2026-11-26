// 龙笛（日本雅乐的横笛）：竹管里衬着漆，高而尖，气声亮；雅乐里在筚篥上方缠绕，长音的开头常从下面滑上来。
import type { RegionalDef } from "./types";

export const RYUTEKI: RegionalDef = {
  key: "ryuteki",
  region: "japan",
  name: { zh: "龙笛", en: "Ryūteki" },
  instrument: {
    kind: "wind",
    amps: (n) => [1, 0.42, 0.25, 0.12, 0.07, 0.04][n - 1] ?? 0,
    attack: 0.04,
    release: 0.1,
    vib: { rate: 5, depth: 8, delay: 0.5 },
    breath: { level: 0.13, q: 0.9, ratio: 2 },
    pulse: { level: 0.12, q: 1.2, ratio: 3 },
    puff: { level: 0.15, decay: 0.08 },
    drift: 6,
    chiff: 0.06,
    tongue: 0.65,
    glide: 0.06,
    blare: { from: 2500, to: 7000, time: 0.25 },
    level: 0.24,
  },
  demo: { key: "E dorian", qpm: 66, bars: 3, abc: "!bend!e4 {f}e2 d2 | !bend!B6 A2 | (d2 e2) !vib!e4" },
};
