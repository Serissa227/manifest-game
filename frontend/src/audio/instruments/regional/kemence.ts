// 克曼切（奥斯曼的小提琴，竖着拉）：三根弦、用指甲从侧面碰弦，声音细、鼻音重，揉音快；宫廷的古典音乐与奈伊笛、卡农琴一起。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const KEMENCE: RegionalDef = {
  key: "kemence",
  region: "ottoman",
  name: { zh: "克曼切", en: "Kemençe" },
  instrument: {
    kind: "bowed",
    amps: (n, f) => (1 / Math.pow(n, 0.8)) * (0.35 + bump(f, 900, 0.4, 0.6) + bump(f, 1900, 0.45, 0.8) + bump(f, 3400, 0.4, 0.35)) * roll(f, 6500, 3),
    attack: 0.05,
    release: 0.1,
    vib: { rate: 6.6, depth: 14, delay: 0.16 },
    vibBoost: 2,
    breath: { level: 0.014, q: 0.7, ratio: 6 },
    pulse: { level: 0.09, q: 0.9, ratio: 4.5 },
    chiff: 0.035,
    tongue: 0.65,
    glide: 0.07,
    drift: 4,
    level: 0.36,
  },
  demo: { key: "A hijaz", qpm: 84, bars: 3, abc: "A2 B c d2 e2 | f e d c !vib!d4 | (c B) A G !fall!A4" },
};
