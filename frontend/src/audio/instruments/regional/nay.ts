// 奈伊笛（奥斯曼的苇笛，新的一版）：斜吹，气多音少，像带着沙的风；揉音慢而深（!vib!），音头从下面上来（!bend!）。
// 旧的 ney 不动（别的曲子在用）。
import type { RegionalDef } from "./types";

export const NAY: RegionalDef = {
  key: "nay",
  region: "ottoman",
  name: { zh: "奈伊笛（新）", en: "Ney" },
  instrument: {
    kind: "wind",
    amps: (n) => [1, 0.5, 0.32, 0.16, 0.1, 0.05][n - 1] ?? 0,
    attack: 0.1,
    release: 0.18,
    vib: { rate: 4.8, depth: 14, delay: 0.3 },
    vibBoost: 2.4,
    breath: { level: 0.3, q: 0.6, ratio: 1.8 },
    pulse: { level: 0.2, q: 1, ratio: 2.5 },
    puff: { level: 0.25, decay: 0.15 },
    tremor: { rate: 1.1, depth: 0.12 },
    drift: 7,
    chiff: 0.03,
    tongue: 0.75,
    glide: 0.08,
    blare: { from: 1600, to: 4500, time: 0.3 },
    level: 0.22,
  },
  demo: { key: "A hijaz", qpm: 70, bars: 3, abc: "!bend!A4 B2 c2 | !vib!d6 c B | (A2 G2) !fall!A4" },
};
