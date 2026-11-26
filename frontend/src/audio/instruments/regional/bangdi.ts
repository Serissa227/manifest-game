// 梆笛（明的笛子，北方的高音笛）：笛膜的“沙沙”是它的魂——跟着每个周期一开一合的高频噪声（pulse 在五倍频上），亮而透；
// 花舌、打音写倚音，上滑写 !bend!。旧的 dizi 不动（别的曲子在用），这件更亮、笛膜更响。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const BANGDI: RegionalDef = {
  key: "bangdi",
  region: "ming",
  name: { zh: "梆笛", en: "Bangdi" },
  instrument: {
    kind: "wind",
    amps: (n, f) => ((n === 1 ? 1 : 0.6 / Math.pow(n, 0.7)) + bump(f, 3200, 0.55, 0.45) + bump(f, 5000, 0.4, 0.25)) * roll(f, 9000),
    attack: 0.02,
    release: 0.06,
    vib: { rate: 5.8, depth: 12, delay: 0.25 },
    vibBoost: 2,
    breath: { level: 0.05, q: 1.2, ratio: 2 },
    pulse: { level: 0.3, q: 1.6, ratio: 5 },
    chiff: 0.12,
    tongue: 0.45,
    glide: 0.03,
    drift: 3,
    level: 0.28,
  },
  // 加花：倚音、十六分音符的“碎”、上滑
  demo: { key: "D major", qpm: 100, bars: 4, abc: "a2 {b}a f e2 d2 | e/2f/2e/2d/2 B2 A4 | B d e !bend!f2 e d B | !vib!A6 z2" },
};
