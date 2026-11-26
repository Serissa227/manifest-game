// 恰朗戈（安第斯）：五组复弦的小琴，很亮，第三组里夹一根高八度的弦（octave），快速的扫弦像一阵碎银。
import type { RegionalDef } from "./types";

export const CHARANGO: RegionalDef = {
  key: "charango",
  region: "andes",
  name: { zh: "恰朗戈", en: "Charango" },
  instrument: {
    kind: "pluck",
    spec: { t60: 1.2, tilt: 0.4, bright: 0.92, pick: 0.12, damp: 0.11, course: 6, octave: 0.5, thump: 0.07, body: [[500, 1.4, 4], [1500, 1.4, 2], [3200, 1.2, 3]], lp: 10500, max: 2 },
    level: 0.99,
  },
  // 扫弦（和弦）与单音的拨
  demo: { key: "A minor", qpm: 100, bars: 3, abc: "[Ace]2 [Ace] [Ace] [Ace]2 [GBd]2 | [CEGc]2 [CEGc] [CEGc] [GBd]4 | e d c B A4" },
};
