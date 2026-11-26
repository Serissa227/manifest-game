// 泰诺骨笛（加勒比）：泰诺人用鸟骨、海牛骨做的细管笛，在阿雷伊托的歌舞里领头唱一句、众人接一句。
// 管细，所以亮：第二、第三谐波都多，气声细而亮，吐音清楚，揉音轻；比玛雅陶笛亮得多、比安第斯的盖那笛少揉。
import { roll } from "./shape";
import type { RegionalDef } from "./types";

export const BONE_FLUTE: RegionalDef = {
  key: "bone_flute",
  region: "taino",
  name: { zh: "泰诺骨笛", en: "Taíno bone flute" },
  instrument: {
    kind: "wind",
    amps: (n, f) => ([1, 0.38, 0.28, 0.12, 0.08, 0.04][n - 1] ?? 0) * roll(f, 6500, 2),
    attack: 0.025,
    release: 0.06,
    vib: { rate: 5.8, depth: 8, delay: 0.35 },
    breath: { level: 0.15, q: 1.2, ratio: 2.4 },
    pulse: { level: 0.12, q: 1.3, ratio: 3.4 },
    puff: { level: 0.12, decay: 0.04 },
    drift: 6,
    chiff: 0.06,
    tongue: 0.4,
    glide: 0.02,
    level: 0.243,
  },
  // 领唱的一句（倚音、重复音），众人接的一句（落回主音）
  demo: { key: "F major", qpm: 104, bars: 4, abc: "c2 A c d2 {e}d c | A2 G2 F4 | A2 A c d2 c A | G2 F2 !fall!F4" },
};
