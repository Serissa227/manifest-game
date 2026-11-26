// 龟甲（玛雅与阿兹特克的 ayotl）：一面大龟壳，用鹿角敲两侧——干、硬的“咔”，高低两个音。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const AYOTL: RegionalDef = {
  region: "maya",
  name: { zh: "龟甲", en: "Turtle shell" },
  drums: {
    ayotl_hi: { layers: [skin(950, 930, 0.01, 0.07, 0.8, [[1.62, 0.45, 0.05], [2.4, 0.3, 0.035]]), hiss(2000, 8000, 0.006, 0.6)] },
    ayotl_lo: { layers: [skin(560, 550, 0.01, 0.09, 0.8, [[1.7, 0.4, 0.06]]), hiss(1800, 7000, 0.006, 0.5)] },
  },
  demo: { key: "C major", qpm: 100, bars: 3, drum: [{ steps: "h.l.h.hlh.l.hhl.h.l.h.hl", hits: { h: ["ayotl_hi", 0.85], l: ["ayotl_lo", 0.8] } }] },
};
