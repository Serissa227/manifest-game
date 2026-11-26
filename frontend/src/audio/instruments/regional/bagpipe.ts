// 风笛（低地国家的 doedelzak、英格兰与苏格兰的风笛：布鲁盖尔画里农民节庆上的那一支）——这里是唱管（chanter）：
// 锥形管的双簧，皮囊供气，所以音量恒定、不能吐音、不能停：音与音之间一直连着（tongue 接近 1），
// 同一个音要再奏一次只能靠倚音“切”开（写 {g}、{e}、{d} 之类的装饰音）；没有揉音，手指一换音就到（滑音极短）；
// 谐波齐全而且很亮，1 kHz 与 2.7 kHz 一带的共振峰是它“刺”的颜色；皮囊的压力让音量与音高有一点极慢的起伏。
// 持续音（drone）另是一件乐器 pipe_drone（pipeDrone.ts），曲谱里另开一个声部。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const BAGPIPE: RegionalDef = {
  key: "bagpipe",
  region: "north_europe",
  name: { zh: "风笛（唱管）", en: "Bagpipe chanter (doedelzak)" },
  instrument: {
    kind: "wind",
    amps: (n, f) => (1 / Math.pow(n, 0.2)) * (0.32 + bump(f, 1050, 0.55, 0.85) + bump(f, 2700, 0.5, 0.6) + bump(f, 4300, 0.4, 0.22)) * roll(f, 7000, 3),
    attack: 0.018,
    release: 0.09,
    breath: { level: 0.012, q: 0.8, ratio: 3 },
    pulse: { level: 0.05, q: 0.9, ratio: 4 },
    tremor: { rate: 0.45, depth: 0.04 },
    drift: 2,
    chiff: 0.012,
    tongue: 0.94,
    glide: 0.006,
    level: 0.35,
  },
  // G 混合利底亚：倚音切开重复的音（{a}G、{g}F），一口气不停
  demo: { key: "G mixolydian", qpm: 100, bars: 4, abc: "d2 {e}d B c2 A2 | B2 G2 {a}G2 A B | c2 e2 d2 c B | A2 F2 {g}F2 G2" },
};
