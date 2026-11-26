// 古多克（罗斯的三弦民间提琴 gudok：说唱人 skomorokh 抵在膝上拉的那一把）：琴码是平的，弓毛同时擦着两三根弦——
// 旋律在最高的弦上，下面的空弦一直嗡着（曲谱里另开一个声部用 drone 伴奏型写空弦）；
// 粗、鼻音重、弓噪大（跟着波形起伏的沙声比提琴多得多），揉音很浅，起弓有一下“嚓”。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const GUDOK: RegionalDef = {
  key: "gudok",
  region: "north_europe",
  name: { zh: "古多克（罗斯的民间提琴）", en: "Gudok" },
  instrument: {
    kind: "bowed",
    amps: (n, f) => (1 / Math.pow(n, 0.62)) * (0.3 + bump(f, 560, 0.4, 0.6) + bump(f, 1300, 0.45, 0.95) + bump(f, 2800, 0.5, 0.5)) * roll(f, 5200, 3),
    attack: 0.035,
    release: 0.1,
    vib: { rate: 5.6, depth: 7, delay: 0.3 },
    breath: { level: 0.016, q: 0.7, ratio: 5 },
    pulse: { level: 0.12, q: 0.8, ratio: 4 },
    chiff: 0.06,
    tongue: 0.58,
    glide: 0.035,
    drift: 5,
    level: 0.33,
  },
  // A 小调的舞曲：十六分音符的碎弓、句尾往下落
  demo: { key: "A minor", qpm: 120, bars: 4, abc: "e/2e/2e/2d/2 c B c/2d/2e/2c/2 A2 | e/2e/2e/2d/2 c B A/2B/2c/2B/2 A2 | G/2A/2B/2c/2 d B c/2B/2A/2G/2 E2 | A/2B/2c/2d/2 e c B/2c/2B/2G/2 !fall!A2" },
};
