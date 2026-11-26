// 筚篥（日本雅乐）：很短的竹管、很大的芦苇哨片，声音粗、鼻音重、很响；音与音之间用嘴唇推出的滑音（塩梅，enbai）连着，写 !bend! 与圆滑线。
import { reedAmps } from "./shape";
import type { RegionalDef } from "./types";

export const HICHIRIKI: RegionalDef = {
  key: "hichiriki",
  region: "japan",
  name: { zh: "筚篥", en: "Hichiriki" },
  instrument: {
    kind: "wind",
    amps: reedAmps(0.45, [[1500, 0.5, 0.9], [3000, 0.5, 0.4]], 6500),
    attack: 0.06,
    release: 0.12,
    vib: { rate: 4.2, depth: 6, delay: 0.6 },
    breath: { level: 0.03, q: 0.8, ratio: 3 },
    pulse: { level: 0.08, q: 0.9, ratio: 4 },
    drift: 8,
    chiff: 0.03,
    tongue: 0.75,
    glide: 0.16,
    blare: { from: 1600, to: 5000, time: 0.4 },
    level: 0.27,
  },
  // 平调一类：塩梅推上去的长音
  demo: { key: "E dorian", qpm: 60, bars: 3, abc: "!bend!E4 (F2 !bend!A2) | B6 !fall!A2 | !bend!F4 E4" },
};
