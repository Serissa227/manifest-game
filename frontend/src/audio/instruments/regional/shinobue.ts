// 篠笛（日本的祭笛）：细竹的横笛，高、亮、带一点沙，祭礼的囃子里领奏；手指“打”出来的倚音很多，几乎不揉。
import type { RegionalDef } from "./types";

export const SHINOBUE: RegionalDef = {
  key: "shinobue",
  region: "japan",
  name: { zh: "篠笛", en: "Shinobue" },
  instrument: {
    kind: "wind",
    amps: (n) => [1, 0.3, 0.14, 0.06, 0.03][n - 1] ?? 0,
    attack: 0.025,
    release: 0.07,
    vib: { rate: 5.5, depth: 6, delay: 0.5 },
    breath: { level: 0.1, q: 1, ratio: 2 },
    pulse: { level: 0.1, q: 1.3, ratio: 3.5 },
    puff: { level: 0.1, decay: 0.05 },
    drift: 4,
    chiff: 0.1,
    tongue: 0.4,
    glide: 0.025,
    level: 0.25,
  },
  // 阳音阶（A B D E 升F），手指打出来的倚音
  demo: { key: "A dorian", qpm: 104, bars: 4, abc: "e2 {f}e d B2 A2 | B d e f e2 d2 | {e}d2 B A B4 | A6 z2" },
};
