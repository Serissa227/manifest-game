// 皮奈（pi nai，暹罗的四簧双簧管）：棕榈叶的哨片插在一截中间鼓起的红木管上，没有喇叭口；鼻音重、“嗡嗡”地喊，
// 乐手用循环换气一口气吹到底（音与音之间几乎不断），装饰音、滑音不停——piphat 乐队里唯一的吹管，旋律最自由的一层。
import { reedAmps } from "./shape";
import type { RegionalDef } from "./types";

export const PI_NAI: RegionalDef = {
  key: "pi_nai",
  region: "siam",
  name: { zh: "皮奈（暹罗双簧管）", en: "Pi nai" },
  instrument: {
    kind: "wind",
    // 共振峰比唢呐低（850、1650 Hz）：更“嗡”、更鼻音，不那么亮
    amps: reedAmps(0.42, [[850, 0.45, 0.9], [1650, 0.5, 0.75], [3100, 0.45, 0.35]], 6500),
    attack: 0.035,
    release: 0.09,
    vib: { rate: 5.0, depth: 14, delay: 0.28 },
    vibBoost: 2.2,
    breath: { level: 0.022, q: 0.8, ratio: 3 },
    pulse: { level: 0.08, q: 0.9, ratio: 3.2 },
    chiff: 0.035,
    tongue: 0.8,
    glide: 0.09,
    drift: 6,
    blare: { from: 1500, to: 5200, time: 0.18 },
    level: 0.25,
  },
  demo: { key: "G mixolydian", qpm: 80, bars: 3, abc: "{A}G2 A _/B !bend!d4 | (_/e d) (_/B A) !vib!G4 | A _/B d _/e !fall!d4" },
};
