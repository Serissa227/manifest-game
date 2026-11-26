// 塔尔卡（安第斯高原的木制哨笛）：方形的木管，几支一起吹平行四度、五度，声音粗、带“沙沙”的嘶，几乎不揉——像一群人在风里喊。
import type { RegionalDef } from "./types";

export const TARKA: RegionalDef = {
  key: "tarka",
  region: "andes",
  name: { zh: "塔尔卡木笛", en: "Tarka" },
  instrument: {
    kind: "wind",
    amps: (n) => [1, 0.55, 0.45, 0.3, 0.22, 0.14, 0.08][n - 1] ?? 0,
    attack: 0.04,
    release: 0.09,
    vib: { rate: 5, depth: 4, delay: 0.6 },
    breath: { level: 0.12, q: 0.7, ratio: 2.5 },
    pulse: { level: 0.24, q: 0.8, ratio: 3.5 },
    puff: { level: 0.15, decay: 0.05 },
    drift: 8,
    chiff: 0.1,
    tongue: 0.35,
    glide: 0.02,
    level: 0.26,
  },
  demo: { key: "A minor", qpm: 104, bars: 3, abc: "A2 A c e2 d c | A2 G2 E4 | A c d e A4" },
};
