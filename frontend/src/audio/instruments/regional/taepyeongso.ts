// 太平箫（태평소，朝鲜，又叫“号笛”“날라리”）：锥形木管、铜碗，双簧，尖、亮、刺耳，农乐（풍물）与军中的吹打（대취타）里领着锣鼓；
// 与明的唢呐同源，但吹法更“野”：滑音大（!bend! !fall!）、揉得急，长音常常拉成一声喊。
import { reedAmps } from "./shape";
import type { RegionalDef } from "./types";

export const TAEPYEONGSO: RegionalDef = {
  key: "taepyeongso",
  region: "korea",
  name: { zh: "太平箫", en: "Taepyeongso" },
  instrument: {
    kind: "wind",
    amps: reedAmps(0.28, [[1400, 0.5, 0.9], [3000, 0.5, 0.7], [5000, 0.4, 0.3]], 8500),
    attack: 0.025,
    release: 0.07,
    vib: { rate: 6.2, depth: 14, delay: 0.25 },
    vibBoost: 2.4,
    breath: { level: 0.025, q: 0.8, ratio: 3 },
    pulse: { level: 0.09, q: 0.9, ratio: 4 },
    chiff: 0.06,
    tongue: 0.5,
    glide: 0.06,
    drift: 6,
    blare: { from: 2400, to: 8000, time: 0.1 },
    level: 0.3,
  },
  // 农乐里的一声喊、滑下来、折音
  demo: { key: "A minor", qpm: 96, bars: 3, abc: "!bend!e3 d c A2 c | !bend!d2 e2 !vib!e4 | (d c) (c B) !fall!A4" },
};
