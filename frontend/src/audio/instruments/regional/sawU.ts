// 索乌（saw u，暹罗的椰壳胡琴）：琴筒是半个椰子壳蒙着牛皮，两根丝弦，弓毛夹在弦中间；声音低、圆、空，像隔着木门说话，
// mahori 乐队里拉长音、托着克卢伊竖笛。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const SAW_U: RegionalDef = {
  key: "saw_u",
  region: "siam",
  name: { zh: "索乌（椰壳胡琴）", en: "Saw u" },
  instrument: {
    kind: "bowed",
    // 椰壳的共鸣低（420、900 Hz），比二胡、雷巴布都暗
    amps: (n, f) => (1 / Math.pow(n, 0.95)) * (0.4 + bump(f, 420, 0.45, 0.8) + bump(f, 900, 0.4, 0.55) + bump(f, 1800, 0.5, 0.2)) * roll(f, 3500, 3),
    attack: 0.08,
    release: 0.15,
    vib: { rate: 5.2, depth: 13, delay: 0.25 },
    vibBoost: 2,
    breath: { level: 0.014, q: 0.7, ratio: 5 },
    pulse: { level: 0.09, q: 0.9, ratio: 3 },
    chiff: 0.025,
    tongue: 0.7,
    glide: 0.1,
    drift: 5,
    level: 0.32,
  },
  demo: { key: "G mixolydian", qpm: 72, bars: 3, abc: "G,2 A, _/B, D2 _/E D | !vib!_/B,6 A,2 | (G, A,) _/B, A, !fall!G,4" },
};
