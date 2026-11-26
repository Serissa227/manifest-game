// 恩戈马（斯瓦希里海岸的鼓组）：高大的姆松多（msondo）低沉、长，小的恰普奥（chapuo）高、紧，两只交错着打 3 + 3 + 2。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const NGOMA: RegionalDef = {
  region: "swahili",
  name: { zh: "恩戈马鼓", en: "Ngoma" },
  drums: {
    msondo: { layers: [skin(120, 80, 0.03, 0.6, 1, [[1.6, 0.2, 0.25]]), hiss(100, 800, 0.04, 0.4)] },
    chapuo: { layers: [skin(420, 380, 0.01, 0.12, 0.8, [[1.6, 0.25, 0.08]]), hiss(1500, 6000, 0.015, 0.5)] },
  },
  demo: {
    key: "C major",
    qpm: 108,
    bars: 3,
    drum: [
      { steps: "M..M..M.", hits: { M: ["msondo", 0.9] } },
      { steps: ".cc.cc.c", hits: { c: ["chapuo", 0.7] } },
    ],
  },
};
