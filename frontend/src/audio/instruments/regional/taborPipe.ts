// 三孔笛（英格兰与低地的 pipe and tabor：一人左手吹笛、右手打挂在臂上的小鼓——莫里斯舞与村里的节庆）：
// 管很细，只有三个孔，全靠吹出第二、三、四泛音走音阶，所以声音高、亮、带一点尖的气声；
// 每个音都用舌头吐开（起音的“嘟”很清楚），几乎不揉。小鼓是 taborin（taborin.ts）。普罗旺斯的那一支是 galoubet（galoubet.ts）。
import type { RegionalDef } from "./types";

export const TABOR_PIPE: RegionalDef = {
  key: "tabor_pipe",
  region: "north_europe",
  name: { zh: "三孔笛（英格兰）", en: "Three-hole pipe (pipe and tabor)" },
  instrument: {
    kind: "wind",
    amps: (n) => [1, 0.3, 0.13, 0.05, 0.025][n - 1] ?? 0,
    attack: 0.018,
    release: 0.05,
    vib: { rate: 5.6, depth: 5, delay: 0.4 },
    breath: { level: 0.055, q: 1.4, ratio: 2.2 },
    pulse: { level: 0.05, q: 1.1, ratio: 3 },
    chiff: 0.17,
    tongue: 0.32,
    glide: 0.015,
    drift: 3,
    level: 0.25,
  },
  // D 混合利底亚（还原 C）的号笛舞：“短—长—短”的切分，句尾两个长音
  demo: { key: "D mixolydian", qpm: 120, bars: 5, abc: "f2 a4 a2 | g2 f2 e2 c2 | f2 a4 b2 | c'2 a2 f2 e2 | d6 z2" },
};
