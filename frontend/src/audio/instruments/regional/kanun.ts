// 卡农琴（奥斯曼与阿拉伯）：金属指套拨三根一组的羊肠弦，梯形的箱体，脆、亮、余音短；长音按轮指（快速的重复拨）。
import type { RegionalDef } from "./types";

export const KANUN: RegionalDef = {
  key: "kanun",
  region: "ottoman",
  name: { zh: "卡农琴", en: "Kanun" },
  instrument: {
    kind: "pluck",
    spec: { t60: 1.8, tilt: 0.5, bright: 0.9, pick: 0.09, damp: 0.14, course: 4, thump: 0.1, onset: 0.0025, body: [[250, 1.2, 2], [900, 1.3, 2], [2600, 1.2, 4]], lp: 10500, max: 2.8 },
    level: 0.97,
    tremolo: 0.6,
    tremRate: 15,
  },
  demo: { key: "A hijaz", qpm: 100, bars: 3, abc: "a b c' d' e' d' c' b | a g f e d c B2 | A8" },
};
