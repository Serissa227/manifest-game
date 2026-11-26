// 达巴坎（dabakan，菲律宾南部的高脚杯形单面鼓）：蒙着蜥蜴或蟒的皮，两根细竹棍打，“嗒、嗒”的又高又脆、带一点短短的鼓皮音；
// 敲鼓边是更干的“咯”。它给锣乐队定下节奏型（sinulog、duyug……）。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const DABAKAN: RegionalDef = {
  region: "philippines",
  name: { zh: "达巴坎（杯形鼓）", en: "Dabakan" },
  drums: {
    dabakan: { layers: [skin(310, 285, 0.012, 0.18, 1, [[1.58, 0.3, 0.1], [2.2, 0.15, 0.06]], 0.0008), hiss(1500, 7000, 0.015, 0.6, { attack: 0.0008 })] },
    dabakan_rim: { layers: [skin(1600, 1580, 0.01, 0.05, 0.5, undefined, 0.0008), hiss(2000, 9000, 0.01, 0.8, { attack: 0.0008 })] },
  },
  demo: { key: "C major", qpm: 120, bars: 3, drum: [{ steps: "D.dDd.D.r.D.dDd.DdD.r.Dd", hits: { D: ["dabakan", 0.85], d: ["dabakan", 0.5], r: ["dabakan_rim", 0.7] } }] },
};
