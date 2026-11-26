// 手摇弦琴的持续音弦（bourdon 低音弦与 mouche 次中音弦）：同一个木轮擦着，锯齿波的嗡、琴箱的鼻音，起音是木轮咬上弦的一下；
// 两根弦各自差一点音高（齐奏）。曲谱里用 drone 伴奏型写，例如 G 调的琴：notes: [43, 50]（G2 与 D3）。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const HURDY_DRONE: RegionalDef = {
  key: "hurdy_drone",
  region: "north_europe",
  name: { zh: "手摇弦琴的持续音弦", en: "Hurdy-gurdy drones (bourdon, mouche)" },
  instrument: {
    kind: "pad",
    amps: (n, f) => (1 / Math.pow(n, 0.8)) * (0.4 + bump(f, 520, 0.45, 0.5) + bump(f, 1500, 0.45, 0.6) + bump(f, 3000, 0.45, 0.3)) * roll(f, 5500, 3),
    attack: 0.12,
    release: 0.4,
    breath: { level: 0.012, q: 0.7, ratio: 6 },
    unison: { voices: 2, spread: 4 },
    glide: 0.05,
    level: 0.16,
  },
  demo: { key: "G major", qpm: 80, bars: 3, abc: "[G,,D,]8 | [G,,D,]8 | [G,,D,G,]8" },
};
