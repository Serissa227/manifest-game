// 法兰西的风笛（cornemuse du Centre：贝里、波旁一带与手摇弦琴搭档的那一支；宫廷里更柔的 musette 也是这一族）：
// 比低地的 doedelzak 甜、暗一些，像带着鼻音的双簧管——谐波随次数衰减得快（tilt 大），1.4 kHz 的共振峰；
// 同样是皮囊供气：音量恒定、音与音连着、没有揉音，重复的音用倚音切开。持续音另写（pipe_drone 或手摇弦琴的 hurdy_drone）。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const CORNEMUSE: RegionalDef = {
  key: "cornemuse",
  region: "north_europe",
  name: { zh: "法兰西风笛", en: "Cornemuse (French bagpipe)" },
  instrument: {
    kind: "wind",
    amps: (n, f) => (1 / Math.pow(n, 0.55)) * (0.45 + bump(f, 1400, 0.5, 0.75) + bump(f, 3000, 0.45, 0.25)) * roll(f, 5600, 3),
    attack: 0.02,
    release: 0.1,
    breath: { level: 0.015, q: 0.8, ratio: 2.5 },
    pulse: { level: 0.035, q: 1, ratio: 3 },
    tremor: { rate: 0.5, depth: 0.04 },
    drift: 2.5,
    chiff: 0.01,
    tongue: 0.92,
    glide: 0.008,
    level: 0.27,
  },
  // G 大调，布雷舞的长—短：倚音切开同一个音
  demo: { key: "G major", qpm: 100, bars: 3, abc: "d2 e f2 d g2 | f e2 {f}e d2 B2 | c2 A2 G4" },
};
