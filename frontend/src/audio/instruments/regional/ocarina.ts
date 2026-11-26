// 陶笛（玛雅的陶制哨笛与容器笛）：几乎是纯的正弦，一点气，起音清清楚楚；两支一起吹（下方三度）是玛雅的双管笛。
import type { RegionalDef } from "./types";

export const OCARINA: RegionalDef = {
  key: "ocarina",
  region: "maya",
  name: { zh: "陶笛", en: "Clay flute" },
  instrument: {
    kind: "wind",
    amps: (n) => [1, 0.06, 0.035, 0.01][n - 1] ?? 0,
    attack: 0.04,
    release: 0.08,
    vib: { rate: 5.6, depth: 7, delay: 0.4 },
    breath: { level: 0.08, q: 1.2, ratio: 1.3 },
    pulse: { level: 0.05, q: 1.3, ratio: 3 },
    puff: { level: 0.08, decay: 0.05 },
    drift: 4,
    chiff: 0.07,
    tongue: 0.4,
    glide: 0.025,
    level: 0.25,
  },
  demo: { key: "G minor", qpm: 100, bars: 4, abc: "d3 B c2 d2 | !vib!c4 G4 | B2 c d f2 d2 | !vib!G8" },
};
