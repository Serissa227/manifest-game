// 瓦辛特笛（埃塞俄比亚）：竹子做的竖吹笛，四个按孔，牧人与阿兹马里都吹；气声多、软，
// 一口气吹进去先“噗”一下，长音上一涨一落地颤，句子里有很多倚音和往下落的尾巴。
import type { RegionalDef } from "./types";

export const WASHINT: RegionalDef = {
  key: "washint",
  region: "ethiopia",
  name: { zh: "瓦辛特笛", en: "Washint" },
  instrument: {
    kind: "wind",
    amps: (n) => [1, 0.42, 0.18, 0.09, 0.05, 0.025][n - 1] ?? 0,
    attack: 0.06,
    release: 0.14,
    vib: { rate: 5.2, depth: 12, delay: 0.28 },
    vibBoost: 2.6,
    breath: { level: 0.24, q: 0.7, ratio: 1.6 },
    pulse: { level: 0.16, q: 1, ratio: 2.8 },
    puff: { level: 0.22, decay: 0.1 },
    tremor: { rate: 0.9, depth: 0.12 },
    drift: 6,
    chiff: 0.04,
    tongue: 0.7,
    glide: 0.06,
    blare: { from: 1500, to: 4800, time: 0.25 },
    level: 0.225,
  },
  // 巴蒂（小调的一种：E G A B D）：倚音、深揉、句尾落下
  demo: { key: "E phrygian", qpm: 84, bars: 4, abc: "!bend!B4 {c}B A G E | !vib!G6 E D | E2 G A B2 {d}B A | !fall!E6 z2" },
};
