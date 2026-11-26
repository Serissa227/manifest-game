// 坦宾笛（几内亚富塔贾隆高原的富拉人的笛子，Fula flute）：一根斜吹的竹笛（或葫芦藤），三个按孔，吹的人一边吹一边用喉咙哼着唱——
// 气声很重、带一层喉音的“嗡”，长音上颤得快，句头从下面滑上来；牧人赶着牛走在高原上吹，曼丁的乐队里也有它。
// 西非的乐器大多是拨奏与击奏，它是少有的能拉长音的旋律乐器（航海曲里唱长浪的那一句）。
import type { RegionalDef } from "./types";

export const TAMBIN: RegionalDef = {
  key: "tambin",
  region: "guinea",
  name: { zh: "坦宾笛（富拉笛）", en: "Tambin (Fula flute)" },
  instrument: {
    kind: "wind",
    amps: (n) => [1, 0.36, 0.22, 0.1, 0.07, 0.04, 0.02][n - 1] ?? 0,
    attack: 0.06,
    release: 0.16,
    vib: { rate: 5.8, depth: 16, delay: 0.22 },
    vibBoost: 2.4,
    // 喉咙哼着唱的“嗡”：跟着波形的噪声在基音附近（ratio 1.2），比别的笛子低、重
    breath: { level: 0.3, q: 0.6, ratio: 1.7 },
    pulse: { level: 0.22, q: 0.8, ratio: 1.2 },
    puff: { level: 0.3, decay: 0.12 },
    tremor: { rate: 1.3, depth: 0.14 },
    drift: 8,
    chiff: 0.05,
    tongue: 0.72,
    glide: 0.08,
    blare: { from: 1400, to: 4400, time: 0.22 },
    level: 0.21,
  },
  // 高原的牧歌：从下面滑上来、长音颤、句尾落下
  demo: { key: "D mixolydian", qpm: 80, bars: 4, abc: "!bend!A4 B2 d2 | !vib!e6 d B | A2 B2 d2 c2 | !fall!A6 z2" },
};
