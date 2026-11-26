// 拉利（斐济、汤加的 lali）：一整段硬木挖成的大裂缝鼓，横放在地上，两根粗棍敲——低沉的木头“咚”，传得很远，
// 召集、报信、仪式都用它；跳舞时配一只小的“舞蹈拉利”（lali ni meke，lali_meke），高而亮。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const LALI: RegionalDef = {
  region: "pacific",
  name: { zh: "拉利大木鼓", en: "Lali (slit drum)" },
  drums: {
    lali: { layers: [skin(170, 132, 0.02, 0.9, 1, [[2.1, 0.32, 0.3], [3.45, 0.14, 0.14], [5.3, 0.06, 0.06]], 0.0008), hiss(150, 1200, 0.02, 0.4, { attack: 0.001 })] },
    lali_meke: { layers: [skin(440, 428, 0.008, 0.25, 0.85, [[2.25, 0.3, 0.07], [3.8, 0.12, 0.035]], 0.0005), hiss(1200, 6000, 0.008, 0.5, { attack: 0.0006 })] },
  },
  // 大拉利报信，小拉利在后半拍应
  demo: { key: "C major", qpm: 90, bars: 3, drum: [{ steps: "L..mL..mL.mL.m.L..mL.mm.", hits: { L: ["lali", 0.9], m: ["lali_meke", 0.7] } }] },
};
