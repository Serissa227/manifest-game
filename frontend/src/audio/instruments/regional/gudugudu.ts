// 古杜古杜（约鲁巴说话鼓队里的小锅形鼓，gudugudu）：一只小木碗（或陶碗）蒙皮，鼓心贴着一块黑色的调音膏（ìda），
// 用两根弯的皮条敲——敲在调音膏上是低而闷的“咚”，敲在膏外的鼓皮上是高而干的“嗒”；
// 在鼓队里一直打一个短的固定型，给说话鼓垫底。声音短、干、有音高，与金贝鼓的“通”“啪”不一样。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const GUDUGUDU: RegionalDef = {
  region: "guinea",
  name: { zh: "古杜古杜（小锅鼓）", en: "Gudugudu (small kettle drum)" },
  drums: {
    gudugudu_lo: { layers: [skin(188, 180, 0.008, 0.2, 1, [[1.52, 0.3, 0.09], [2.2, 0.1, 0.05]], 0.0003), hiss(500, 2500, 0.01, 0.3)], vary: 0.012 },
    gudugudu_hi: { layers: [skin(372, 360, 0.005, 0.1, 0.8, [[1.58, 0.3, 0.05]], 0.0003), hiss(1500, 6000, 0.012, 0.45)], vary: 0.012 },
  },
  // 12/8：咚 · 嗒 嗒 · 嗒 咚 · · 嗒 · 嗒
  demo: { key: "C major", qpm: 120, bars: 3, drum: [{ steps: "D.kk.kD..k.kD.kk.kD..kkk", hits: { D: ["gudugudu_lo", 0.85], k: ["gudugudu_hi", 0.75] } }] },
};
