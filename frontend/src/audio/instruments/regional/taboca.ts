// 塔博卡竹笛（巴西图皮人；taboca 是图皮语的“竹”）：粗竹管的笛子，常两支成对地吹。粗管所以低、空、气多，
// 音头先“噗”出一口气，几乎不揉（比安第斯的盖那笛平、比泰诺骨笛暗），气息一涨一落，句尾常往下滑落。
import type { RegionalDef } from "./types";

export const TABOCA: RegionalDef = {
  key: "taboca",
  region: "tupi",
  name: { zh: "塔博卡竹笛", en: "Taboca (bamboo flute)" },
  instrument: {
    kind: "wind",
    amps: (n) => [1, 0.3, 0.14, 0.09, 0.04, 0.02][n - 1] ?? 0,
    attack: 0.06,
    release: 0.12,
    vib: { rate: 4.6, depth: 5, delay: 0.55 },
    breath: { level: 0.2, q: 0.9, ratio: 1.6 },
    pulse: { level: 0.16, q: 1, ratio: 2.2 },
    puff: { level: 0.26, decay: 0.08 },
    tremor: { rate: 4.2, depth: 0.1 },
    drift: 7,
    chiff: 0.05,
    tongue: 0.5,
    glide: 0.05,
    level: 0.24,
  },
  // 窄的音域里一级级往下走，重复，句尾滑落
  demo: { key: "E dorian", qpm: 112, bars: 4, abc: "B2 B A G2 F2 | E2 F2 G4 | B2 A G F2 E2 | !fall!E8" },
};
