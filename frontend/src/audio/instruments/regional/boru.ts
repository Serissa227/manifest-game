// 博鲁（boru，梅赫特的自然号）：没有按键的长铜号，只能吹出泛音列上的音（D 号：D4 A4 D5 升F5 A5 C6……），
// 比管弦乐队的小号更窄、更“冲”，带一点铜皮的鼻音与嘴唇的嗡；在军乐里吹号令、给祖尔纳的旋律打骨架。
// 曲谱里写博鲁的声部只用泛音列上的音（军乐《新月的战鼓》在 D 上）。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const BORU: RegionalDef = {
  key: "boru",
  region: "ottoman",
  name: { zh: "博鲁号", en: "Boru (natural trumpet)" },
  instrument: {
    kind: "brass",
    amps: (n, f) => (1 / Math.pow(n, 0.32)) * (0.55 + bump(f, 1250, 0.45, 0.85) + bump(f, 2700, 0.45, 0.45)) * roll(f, 5600, 2.6),
    attack: 0.035,
    release: 0.12,
    vib: { rate: 5.4, depth: 6, delay: 0.45 },
    breath: { level: 0.008, q: 1, ratio: 3 },
    // 嘴唇的嗡：跟着波形一开一合的一点噪声
    pulse: { level: 0.05, q: 1.1, ratio: 3.5 },
    chiff: 0.035,
    tongue: 0.3,
    glide: 0.035,
    drift: 4,
    blare: { from: 1000, to: 7000, time: 0.07 },
    level: 0.37,
  },
  // D 号的泛音：号令、长音、再吹一遍
  demo: { key: "D major", qpm: 96, bars: 3, abc: "D2 A2 d2 f2 | a4 f2 d2 | A2 d2 !fall!d4" },
};
