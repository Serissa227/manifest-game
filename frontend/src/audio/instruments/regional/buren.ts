// 号角（满语 buren）：女真与八旗行军、围猎、聚兵吹的长号，粗、低、带着嘶的“呜——”，音头慢慢推上来（!bend!）；
// 按泛音列取音（G2 D3 G3 B3 D4 F4 G4，即长号基音 G1 的第 2 到第 8 泛音），曲谱里也只写这几个音；
// 合成按平均律奏，F4 是 349 Hz，比真号角的第七泛音（约 343 Hz）高约 31 音分（曲子里号角的 F 不与口弦的 F 同时响）。
// 与玛雅的海螺号分开：这件更低、更粗（嘶声跟着波形一开一合），吹得更长。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const BUREN: RegionalDef = {
  key: "buren",
  region: "jurchen",
  name: { zh: "号角（满语 buren）", en: "Buren (horn)" },
  instrument: {
    kind: "brass",
    amps: (n, f) => (1 / Math.pow(n, 0.75)) * (0.5 + bump(f, 600, 0.5, 0.6) + bump(f, 1300, 0.4, 0.25)) * roll(f, 2000, 2.5),
    attack: 0.2,
    release: 0.35,
    vib: { rate: 3.5, depth: 6, delay: 0.6 },
    breath: { level: 0.08, q: 0.7, ratio: 1.5 },
    pulse: { level: 0.14, q: 0.8, ratio: 3 },
    drift: 12,
    tongue: 0.5,
    glide: 0.14,
    blare: { from: 500, to: 2000, time: 0.5 },
    level: 0.33,
  },
  // 聚兵的号：长的一声推上去、跳到上方的泛音、落下来
  demo: { key: "G mixolydian", qpm: 72, bars: 3, abc: "!bend!G,6 z2 | !bend!D2 B,2 !bend!D4 | !fall!G,8" },
};
