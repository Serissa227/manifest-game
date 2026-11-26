// 卡曼恰（波斯的竖拉提琴）：插在膝上的长尖脚，琴筒是一个蒙皮的小圆球，四根钢弦；拉的时候转琴身而不是转弓——
// 声音温暖、鼻音、像人在唱（共振峰在 650 Hz 与 1.35 kHz 一带），比奥斯曼的克曼切（更细、更亮）低沉；
// 滑音长（写圆滑线、!bend!），揉弦深（!vib!），句中有像嗓子里的“塔赫里尔”那样的快速倚音（{…}）。
// 与奥斯曼的 kemence 是两件乐器、两个键。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const KAMANCHEH: RegionalDef = {
  key: "kamancheh",
  region: "persia",
  name: { zh: "卡曼恰", en: "Kamancheh" },
  instrument: {
    kind: "bowed",
    amps: (n, f) => (1 / Math.pow(n, 0.8)) * (0.4 + bump(f, 650, 0.5, 0.6) + bump(f, 1350, 0.4, 0.85) + bump(f, 2500, 0.45, 0.32)) * roll(f, 4800, 3),
    attack: 0.065,
    release: 0.13,
    vib: { rate: 5.8, depth: 16, delay: 0.18 },
    vibBoost: 2.3,
    breath: { level: 0.014, q: 0.7, ratio: 5 },
    pulse: { level: 0.11, q: 0.9, ratio: 4 },
    tremor: { rate: 0.9, depth: 0.08 },
    chiff: 0.03,
    tongue: 0.68,
    glide: 0.085,
    drift: 5,
    level: 0.36,
  },
  // 查哈尔加：滑上去、塔赫里尔的倚音、深揉
  demo: { key: "C chahargah", qpm: 76, bars: 3, abc: "!bend!G4 (A G) F E | {F}E2 (D C) !vib!D4 | (E F) {A}G F !fall!E4" },
};
