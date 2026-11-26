// 羊蹄壳串（安第斯的 chajchas）：一串晒干的羊蹄壳，一抖一阵干的“哗啦”。
import { hiss } from "./shape";
import type { RegionalDef } from "./types";

export const CHAJCHAS: RegionalDef = {
  region: "andes",
  name: { zh: "羊蹄壳串", en: "Chajchas" },
  drums: {
    chajchas: { layers: [hiss(1800, 7000, 0.12, 1, { attack: 0.01, taps: 8 })] },
  },
  demo: { key: "C major", qpm: 100, bars: 3, drum: [{ steps: "c...c...c.c.c...", hits: { c: ["chajchas", 0.8] } }] },
};
