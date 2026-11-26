// 觱篥（피리，朝鲜的乡觱篥）：短的圆柱形竹管、很大的芦苇哨片，粗、厚、鼻音重、很响，是宫廷乐与民间乐队里的领奏；
// 圆柱形的管让奇次谐波更强（偶次弱一些），音与音之间用嘴唇推出很长的滑音（圆滑线、!bend!），长音揉得深（!vib!）。
import { reedAmps } from "./shape";
import type { RegionalDef } from "./types";

const reed = reedAmps(0.42, [[800, 0.5, 0.9], [1900, 0.5, 0.7], [3300, 0.45, 0.3]], 6000);

export const PIRI: RegionalDef = {
  key: "piri",
  region: "korea",
  name: { zh: "觱篥（朝鲜）", en: "Piri" },
  instrument: {
    kind: "wind",
    amps: (n, f) => reed(n, f) * (n % 2 === 1 ? 1 : 0.62),
    attack: 0.05,
    release: 0.1,
    vib: { rate: 5, depth: 12, delay: 0.35 },
    vibBoost: 2.6,
    breath: { level: 0.035, q: 0.8, ratio: 3 },
    pulse: { level: 0.1, q: 0.9, ratio: 3.5 },
    drift: 7,
    chiff: 0.04,
    tongue: 0.7,
    glide: 0.12,
    blare: { from: 1400, to: 5200, time: 0.3 },
    level: 0.25,
  },
  // 圆滑的长滑音、折音、深揉
  demo: { key: "A minor", qpm: 72, bars: 3, abc: "!bend!A4 (c d) !vib!e2 | (d c) (c B) A4 | (E A) (c d) !fall!c4" },
};
