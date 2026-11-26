// 安达卢斯的拉巴卜（马格里布：非斯、得土安、特莱姆森的安达卢斯“努巴”乐队的领奏）：一整块木头挖成的船形琴身，下半截蒙皮，
// 两根很粗的羊肠弦，竖在膝上用弯弓拉——低、沙、带鼻音，弓毛的噪声很重（跟着波形一开一合），揉弦浅而慢；
// 比克曼切与卡曼恰都暗得多（3.6 kHz 以上很快滚降）。与爪哇的 rebab 是两件乐器、两个键。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const RABAB: RegionalDef = {
  key: "rabab",
  region: "maghreb",
  name: { zh: "拉巴卜（安达卢斯）", en: "Andalusian rabab" },
  instrument: {
    kind: "bowed",
    amps: (n, f) => (1 / Math.pow(n, 0.85)) * (0.45 + bump(f, 420, 0.5, 0.75) + bump(f, 1050, 0.45, 0.6) + bump(f, 2200, 0.5, 0.22)) * roll(f, 3600, 3),
    attack: 0.075,
    release: 0.12,
    vib: { rate: 5.2, depth: 9, delay: 0.26 },
    vibBoost: 1.8,
    breath: { level: 0.03, q: 0.6, ratio: 3.5 },
    pulse: { level: 0.17, q: 0.8, ratio: 3 },
    tremor: { rate: 1.3, depth: 0.06 },
    chiff: 0.05,
    tongue: 0.6,
    glide: 0.07,
    drift: 4,
    level: 0.33,
  },
  // 安达卢斯的调（近于 D 多利亚）：低音区一句，句中的倚音与滑过去的连音
  demo: { key: "D dorian", qpm: 84, bars: 3, abc: "D2 E F G2 (F E) | {G}A2 (G F) !vib!E4 | (F E) D C !fall!D4" },
};
