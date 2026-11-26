// 维奥尔琴（viola da gamba / vihuela de arco，文艺复兴）：夹在两腿间拉，六根羊肠弦、有品，弓从下面握；
// 声音细、带鼻音的“簧”味（1 kHz 一带的共振峰），每一弓的音头有一下“说话”的擦弦声，几乎不揉音，音与音之间分得开（tongue 低）。
// 高音维奥尔唱旋律、低音维奥尔走低音（同一件乐器，按音区）；奥尔蒂斯 1553 年在罗马出版的《装饰法》就是写给它的“变奏”（glosas）。
// 与原有的 cello（经典世界拿它当维奥尔琴用）不同：鼻音重、揉音浅、起弓有擦声、余音短。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const GAMBA: RegionalDef = {
  key: "gamba",
  region: "iberia_italy",
  name: { zh: "维奥尔琴", en: "Viola da gamba" },
  instrument: {
    kind: "bowed",
    amps: (n, f) => (1 / Math.pow(n, 0.72)) * (0.45 + bump(f, 300, 0.5, 0.35) + bump(f, 1050, 0.45, 0.65) + bump(f, 2500, 0.5, 0.5) + bump(f, 4200, 0.4, 0.2)) * roll(f, 5600, 3),
    attack: 0.065,
    release: 0.11,
    vib: { rate: 5.4, depth: 5, delay: 0.38 },
    vibBoost: 1.8,
    breath: { level: 0.012, q: 0.7, ratio: 5 },
    pulse: { level: 0.08, q: 0.9, ratio: 4 },
    chiff: 0.04,
    tongue: 0.42,
    glide: 0.035,
    drift: 2,
    level: 0.39,
  },
  // D 小调：一段“变奏”（装饰的经过句）与长音
  demo: { key: "D minor", qpm: 80, bars: 3, abc: "A3 G F E F G | A2 ^c d e f e d | !vib!d8" },
};
