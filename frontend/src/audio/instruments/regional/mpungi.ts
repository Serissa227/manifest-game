// 姆蓬吉（刚果宫廷的象牙号）：一根象牙掏空，侧面开吹口，嘴唇抵着吹（像铜管那样振动），声音粗、暖、带着沙；
// 一支号只吹一两个音，几支号一人一音地轮流（hocket）拼出整句——国王出行、使节到来时吹，十六世纪的葡萄牙人记过它。
// 音头从下面推上来（!bend!），句尾往下落（!fall!）。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const MPUNGI: RegionalDef = {
  key: "mpungi",
  region: "kongo",
  name: { zh: "姆蓬吉（象牙号）", en: "Mpungi (ivory horn)" },
  instrument: {
    kind: "brass",
    amps: (n, f) => (1 / Math.pow(n, 0.85)) * (0.45 + bump(f, 650, 0.55, 0.8) + bump(f, 1500, 0.5, 0.35)) * roll(f, 3200, 3),
    attack: 0.08,
    release: 0.2,
    vib: { rate: 4.5, depth: 7, delay: 0.45 },
    breath: { level: 0.05, q: 0.7, ratio: 3 },
    pulse: { level: 0.12, q: 0.9, ratio: 3.5 },
    drift: 8,
    tremor: { rate: 1.2, depth: 0.08 },
    tongue: 0.45,
    glide: 0.09,
    blare: { from: 800, to: 2800, time: 0.18 },
    level: 0.3,
  },
  // 两三个音的号声：推上去、停住、落下来
  demo: { key: "G major", qpm: 84, bars: 3, abc: "!bend!G,4 z2 D2 | !bend!D6 B,2 | !fall!G,6 z2" },
};
