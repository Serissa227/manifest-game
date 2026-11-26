// 爱琴海的里拉琴（克里特与群岛的 lyra）：梨形、三根弦、竖在膝上拉，左手用指甲从侧面碰弦；
// 比奥斯曼宫廷的克曼切粗一些、亮一些、更“野”——弓子贴着弦的沙（跟着波形的弓噪更重），鼻音在 1.5 kHz 与 2.7 kHz 一带，
// 揉音快而窄，句中满是倚音与颤音（写 {倚音} 与 ~ 回旋音），句尾往下落（!fall!）。拉的时候常带着空弦的持续音（另写一个声部）。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const LYRA: RegionalDef = {
  key: "lyra",
  region: "ottoman",
  name: { zh: "爱琴海里拉琴", en: "Aegean lyra" },
  instrument: {
    kind: "bowed",
    amps: (n, f) => (1 / Math.pow(n, 0.72)) * (0.4 + bump(f, 560, 0.45, 0.5) + bump(f, 1500, 0.4, 0.75) + bump(f, 2700, 0.45, 0.6)) * roll(f, 6200, 3),
    attack: 0.04,
    release: 0.09,
    vib: { rate: 6.3, depth: 11, delay: 0.17 },
    vibBoost: 1.9,
    breath: { level: 0.016, q: 0.7, ratio: 5 },
    pulse: { level: 0.13, q: 0.9, ratio: 3.2 },
    chiff: 0.05,
    tongue: 0.6,
    glide: 0.055,
    drift: 3,
    level: 0.36,
  },
  // D 上的“乌沙克”味（第二级偏低，用巴亚提近似）：倚音、回旋音、落下来
  demo: { key: "D bayati", qpm: 100, bars: 3, abc: "A2 {B}A G F2 {G}F E | D E F G ~A4 | (G F) E D !fall!D4" },
};
