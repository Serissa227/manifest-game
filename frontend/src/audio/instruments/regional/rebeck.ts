// 雷贝克琴（英格兰的 rebeck / 法语 rebec：梨形的小三弦提琴，一整块木头挖成，乡村的提琴手与城里的“号手”（waits）拉它跳舞）：
// 琴身小、没有音柱的大共鸣，声音细、尖、鼻音重——高处 2.2 kHz 与 3.8 kHz 的共振峰；揉音很浅，起弓干脆。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const REBECK: RegionalDef = {
  key: "rebeck",
  region: "north_europe",
  name: { zh: "雷贝克琴", en: "Rebec (English rebeck)" },
  instrument: {
    kind: "bowed",
    amps: (n, f) => (1 / Math.pow(n, 0.72)) * (0.3 + bump(f, 900, 0.5, 0.65) + bump(f, 2200, 0.45, 0.85) + bump(f, 3800, 0.4, 0.4)) * roll(f, 6500, 3),
    attack: 0.03,
    release: 0.08,
    vib: { rate: 5.8, depth: 6, delay: 0.3 },
    breath: { level: 0.01, q: 0.7, ratio: 6 },
    pulse: { level: 0.06, q: 0.9, ratio: 4.5 },
    chiff: 0.05,
    tongue: 0.52,
    glide: 0.025,
    drift: 3,
    level: 0.385,
  },
  // D 混合利底亚的舞曲
  demo: { key: "D mixolydian", qpm: 120, bars: 4, abc: "A2 d4 d2 | e2 f2 g2 e2 | f2 d2 e2 c2 | d6 z2" },
};
