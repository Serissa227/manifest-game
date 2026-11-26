// 排箫（安第斯的西库）：一根根闭管，只有奇次谐波；每个音换一根管，气声很重，起音“噗”地一下，几乎不揉。
// 两排管（ira 与 arka）由两个人分着吹、一人一音地交替（写两个声部轮流），平行四度也常见。
import type { RegionalDef } from "./types";

export const SIKU: RegionalDef = {
  key: "siku",
  region: "andes",
  name: { zh: "排箫（西库）", en: "Siku" },
  instrument: {
    kind: "wind",
    amps: (n) => (n % 2 === 1 ? ([1, 0.25, 0.08, 0.03][(n - 1) / 2] ?? 0) : 0.02 / n),
    attack: 0.035,
    release: 0.12,
    vib: { rate: 5, depth: 5, delay: 0.5 },
    breath: { level: 0.32, q: 0.7, ratio: 2 },
    pulse: { level: 0.18, q: 1, ratio: 3 },
    puff: { level: 0.45, decay: 0.09 },
    tremor: { rate: 6.5, depth: 0.12 },
    drift: 4,
    chiff: 0.1,
    tongue: 0.2,
    glide: 0.005,
    level: 0.17,
  },
  demo: { key: "A minor", qpm: 100, bars: 4, abc: "A2 c2 e2 d2 | c2 A2 G4 | A2 c2 E2 G2 | A8" },
};
