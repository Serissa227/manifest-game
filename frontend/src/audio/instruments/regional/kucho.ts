// 胡弓（くーちょー，琉球）：椰壳或木头的小琴筒蒙蛇皮，三四根弦、竖着拉；声音细、甜、带鼻音，揉弦快而浅，
// 在宫廷的“御座乐”与民谣里跟着三线与歌声走（异音齐奏）。上滑写 !bend!，深揉写 !vib!。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const KUCHO: RegionalDef = {
  key: "kucho",
  region: "ryukyu",
  name: { zh: "胡弓（琉球）", en: "Kūchō" },
  instrument: {
    kind: "bowed",
    amps: (n, f) => (1 / Math.pow(n, 0.8)) * (0.35 + bump(f, 1000, 0.4, 0.6) + bump(f, 2300, 0.45, 0.75) + bump(f, 3800, 0.4, 0.3)) * roll(f, 6500, 3),
    attack: 0.06,
    release: 0.12,
    vib: { rate: 5.8, depth: 12, delay: 0.22 },
    vibBoost: 2,
    breath: { level: 0.012, q: 0.7, ratio: 6 },
    pulse: { level: 0.08, q: 0.9, ratio: 4 },
    chiff: 0.03,
    tongue: 0.7,
    glide: 0.08,
    drift: 4,
    level: 0.36,
  },
  demo: { key: "C major", qpm: 76, bars: 3, abc: "!bend!E3 F G2 B2 | (c2 B G) !vib!G4 | (F G) (E F) !vib!E4" },
};
