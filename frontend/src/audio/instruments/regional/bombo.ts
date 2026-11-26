// 邦博鼓（安第斯，带毛的羊皮大鼓）：低沉的“嘭”，毛皮让高频很少；木框上敲的是“嗒”。瓦伊诺舞的“长 — 短短”由它推着。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const BOMBO: RegionalDef = {
  region: "andes",
  name: { zh: "邦博鼓", en: "Bombo" },
  drums: {
    bombo: { layers: [skin(95, 62, 0.04, 0.6, 1, [[1.5, 0.25, 0.35], [2.1, 0.12, 0.2]]), hiss(80, 600, 0.05, 0.5), hiss(300, 2500, 0.015, 0.2)] },
    bombo_rim: { layers: [skin(1300, 1250, 0.01, 0.04, 0.7, [[1.7, 0.3, 0.03]]), hiss(1500, 6000, 0.006, 0.5)] },
  },
  demo: { key: "C major", qpm: 100, bars: 3, drum: [{ steps: "B..bB.r.B..bBrr.B..bB.rr", hits: { B: ["bombo", 0.9], b: ["bombo", 0.5], r: ["bombo_rim", 0.6] } }] },
};
