// 山羊角号（挪威与瑞典的 bukkehorn / 牧人的号角：一只山羊角钻几个指孔，嘴唇吹响）：
// 声音粗、野、带很多气，音准随着吹的力气游移（慢漂大），力度大时一下子亮起来（blare）；牧场上远远地召唤，音少、长、慢。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const BUKKEHORN: RegionalDef = {
  key: "bukkehorn",
  region: "north_europe",
  name: { zh: "山羊角号", en: "Bukkehorn (goat horn)" },
  instrument: {
    kind: "brass",
    amps: (n, f) => (1 / Math.pow(n, 0.6)) * (0.5 + bump(f, 950, 0.6, 0.6)) * roll(f, 3400, 2.5),
    attack: 0.06,
    release: 0.16,
    vib: { rate: 4.8, depth: 9, delay: 0.4 },
    breath: { level: 0.035, q: 0.8, ratio: 2 },
    pulse: { level: 0.05, q: 0.9, ratio: 3 },
    tremor: { rate: 2.8, depth: 0.08 },
    chiff: 0.03,
    tongue: 0.4,
    glide: 0.06,
    drift: 12,
    blare: { from: 650, to: 2900, time: 0.16 },
    level: 0.315,
  },
  // 牧场上的召唤：长音从下面推上来，句尾落下
  demo: { key: "D minor", qpm: 72, bars: 3, abc: "A3 d3 z2 | !bend!e4 d2 A2 | !fall!d6 z2" },
};
