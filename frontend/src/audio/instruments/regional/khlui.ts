// 克卢伊（khlui，暹罗的竖吹竹笛）：吹口像哨子，管上有一个蒙着薄膜的孔，所以清亮里带一点“沙”；
// mahori（丝竹）乐队里它和索乌胡琴、木琴一起奏，装饰快而密。
import type { RegionalDef } from "./types";

export const KHLUI: RegionalDef = {
  key: "khlui",
  region: "siam",
  name: { zh: "克卢伊（竖笛）", en: "Khlui" },
  instrument: {
    kind: "wind",
    amps: (n) => [1, 0.32, 0.14, 0.07, 0.04, 0.025][n - 1] ?? 0,
    attack: 0.04,
    release: 0.1,
    vib: { rate: 5.6, depth: 15, delay: 0.28 },
    vibBoost: 2,
    breath: { level: 0.1, q: 0.9, ratio: 1.8 },
    // 笛膜的“沙”在五倍频附近
    pulse: { level: 0.08, q: 1.2, ratio: 5 },
    puff: { level: 0.06, decay: 0.05 },
    drift: 4,
    chiff: 0.07,
    tongue: 0.55,
    glide: 0.05,
    level: 0.24,
  },
  demo: { key: "G mixolydian", qpm: 76, bars: 3, abc: "d2 _/e d _/B A G2 | {A}_/B4 !vib!A4 | G A _/B d !bend!_/e4" },
};
