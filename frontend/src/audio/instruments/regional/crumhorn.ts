// 克鲁姆管（德意志与低地的 Krummhorn，法语 cromorne：文艺复兴的“弯角”，苏萨托 1551 年在安特卫普印的舞曲集里常用的一族）：
// 双簧藏在木帽里，嘴唇碰不到——所以没有强弱、没有揉音、只能吐音；管是圆柱形的，像闭管一样奇次谐波强、偶次很弱，
// 高次谐波一直很满：嗡嗡的、带鼻音的“哔—”。常常三四支（高音、中音、次中音、低音）一起奏和声。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const CRUMHORN: RegionalDef = {
  key: "crumhorn",
  region: "north_europe",
  name: { zh: "克鲁姆管", en: "Crumhorn" },
  instrument: {
    kind: "wind",
    amps: (n, f) => ((n % 2 === 1 ? 1 : 0.13) / Math.pow(n, 0.42)) * (0.55 + bump(f, 1150, 0.55, 0.6) + bump(f, 2600, 0.45, 0.25)) * roll(f, 6200, 3),
    attack: 0.014,
    release: 0.05,
    breath: { level: 0.006, q: 0.8, ratio: 3 },
    pulse: { level: 0.03, q: 1, ratio: 3 },
    chiff: 0.025,
    tongue: 0.3,
    glide: 0.012,
    drift: 1.5,
    level: 0.225,
  },
  // 文艺复兴的轮舞：四分音符一步一步走，吐音分开
  demo: { key: "G mixolydian", qpm: 104, bars: 4, abc: "e2 e2 d2 c2 | d2 B2 c2 d2 | e2 c2 A2 B2 | A2 B2 A4" },
};
