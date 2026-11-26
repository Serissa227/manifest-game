// 加拉穆特（美拉尼西亚、新几内亚与新爱尔兰的 garamut）：一人多高的整木裂缝锣，横卧在村子中央，粗木杵竖着往缝边捣——
// 极低、极长的木头“嗡”，几里外的村子也听得见，用固定的节奏报信、召集；捣在缝唇上是高一点的“当”（garamut_hi）。
// 比斐济的拉利更大、更低、余音更长。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const GARAMUT: RegionalDef = {
  region: "pacific",
  name: { zh: "加拉穆特裂缝锣", en: "Garamut (slit gong)" },
  drums: {
    garamut: { layers: [skin(120, 96, 0.03, 1.4, 1, [[1.9, 0.3, 0.5], [3.1, 0.15, 0.25], [4.6, 0.06, 0.1]], 0.001), hiss(80, 900, 0.03, 0.35, { attack: 0.0012 })] },
    garamut_hi: { layers: [skin(260, 245, 0.012, 0.45, 0.85, [[2.0, 0.3, 0.15], [3.3, 0.12, 0.06]], 0.0008), hiss(500, 4000, 0.012, 0.45, { attack: 0.0008 })] },
  },
  // 报信：一下、两下、越捣越密
  demo: { key: "C major", qpm: 80, bars: 3, drum: [{ steps: "G.......G.G.....G.h.G.hG", hits: { G: ["garamut", 0.9], h: ["garamut_hi", 0.75] } }] },
};
