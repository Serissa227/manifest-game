// 加卢贝笛（普罗旺斯的 galoubet：与长鼓 tambourin 一人同奏，马赛与阿尔勒的法兰多拉舞）：三孔笛里最高、最尖的一支，
// 吹的是第三、四泛音，声音很亮、第二谐波强，气声“咝”地带着，吐音利落；比英格兰的三孔笛（tabor_pipe）更尖、更细。
import { bump } from "./shape";
import type { RegionalDef } from "./types";

export const GALOUBET: RegionalDef = {
  key: "galoubet",
  region: "north_europe",
  name: { zh: "加卢贝笛（普罗旺斯）", en: "Galoubet (Provençal pipe)" },
  instrument: {
    kind: "wind",
    amps: (n, f) => ([1, 0.48, 0.26, 0.11, 0.05, 0.02][n - 1] ?? 0) * (1 + bump(f, 3800, 0.5, 0.3)),
    attack: 0.014,
    release: 0.04,
    vib: { rate: 6, depth: 5, delay: 0.35 },
    breath: { level: 0.065, q: 1.5, ratio: 2 },
    pulse: { level: 0.06, q: 1.2, ratio: 3 },
    chiff: 0.2,
    tongue: 0.3,
    glide: 0.012,
    drift: 3,
    level: 0.28,
  },
  // G 大调的法兰多拉：“长—短”一步一步地跳
  demo: { key: "G major", qpm: 96, bars: 3, abc: "d'2 b g2 b d'2 | c'2 a f2 a c'2 | b2 g d2 g g2" },
};
