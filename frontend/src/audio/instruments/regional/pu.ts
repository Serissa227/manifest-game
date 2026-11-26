// 普（波利尼西亚的海螺号 pū，夏威夷、塔希提、毛利都有）：螺壳顶上或侧面钻一个孔来吹，独木舟靠岸、酋长到来、仪式开始时吹；
// 基本只有一个音（偶尔吹上去一个高音），音头粗、慢慢稳住，长长的一声“呜——”，收尾往下落。
// 与玛雅的海螺号（conch）比：更暗（共振峰低、高次谐波少）、起音更慢、音高晃得更多，像远处传来。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const PU: RegionalDef = {
  key: "pu",
  region: "pacific",
  name: { zh: "普（波利尼西亚海螺号）", en: "Pū (Polynesian conch)" },
  instrument: {
    kind: "brass",
    amps: (n, f) => (1 / Math.pow(n, 0.9)) * (0.7 + bump(f, 560, 0.45, 0.6)) * roll(f, 1700, 3),
    attack: 0.22,
    release: 0.45,
    vib: { rate: 3.4, depth: 6, delay: 0.9 },
    breath: { level: 0.07, q: 0.7, ratio: 1.5 },
    pulse: { level: 0.14, q: 0.8, ratio: 3 },
    puff: { level: 0.18, decay: 0.2 },
    tremor: { rate: 0.5, depth: 0.1 },
    drift: 14,
    tongue: 0.55,
    glide: 0.14,
    blare: { from: 450, to: 1600, time: 0.6 },
    level: 0.31,
  },
  // 一声长的（从下面推上来）、再一声吹上去一个高音、最后一声往下落
  demo: { key: "D mixolydian", qpm: 60, bars: 3, abc: "!bend!A,6 z2 | !bend!A,4 E2 A,2 | !fall!A,8" },
};
