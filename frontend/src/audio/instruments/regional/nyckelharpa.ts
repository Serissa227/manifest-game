// 尼克尔哈帕（瑞典乌普兰的键提琴 nyckelharpa）：短弓拉三根旋律弦，左手按的不是弦而是键（木键上的小木片顶住弦）——
// 换音时“嗒”的一小声（chiff），没有滑音，揉音很浅；底下十几根共鸣弦被带着响，整件琴罩着一层银亮的“光”：
// 这里用三个几乎同音高的振荡器（齐奏，错开 3 个音分）拍出那层微光，高处 3–4 kHz 的共振峰比提琴亮，弓停了以后余音还挂一会儿（释音长）。
// 波尔斯卡舞（polska）的主角，常常两把一起奏三度。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const NYCKELHARPA: RegionalDef = {
  key: "nyckelharpa",
  region: "north_europe",
  name: { zh: "尼克尔哈帕（键提琴）", en: "Nyckelharpa" },
  instrument: {
    kind: "bowed",
    amps: (n, f) => (1 / Math.pow(n, 0.8)) * (0.5 + bump(f, 620, 0.5, 0.4) + bump(f, 1800, 0.5, 0.45) + bump(f, 3600, 0.4, 0.7)) * roll(f, 7500, 3),
    attack: 0.04,
    release: 0.38,
    vib: { rate: 5.4, depth: 6, delay: 0.35 },
    breath: { level: 0.006, q: 0.7, ratio: 6 },
    pulse: { level: 0.045, q: 0.9, ratio: 5 },
    unison: { voices: 3, spread: 3 },
    chiff: 0.06,
    tongue: 0.62,
    glide: 0.012,
    drift: 2,
    level: 0.42,
  },
  // D 小调的波尔斯卡：十六分音符的分解、上行再落下
  demo: { key: "D minor", qpm: 100, bars: 3, abc: "d/2e/2f/2g/2 a2 f/2d/2 A d2 | ^c/2d/2e/2f/2 e2 f/2g/2a/2b/2 c'2 | b/2a/2 g f e d4" },
};
