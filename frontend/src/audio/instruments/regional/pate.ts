// 帕特（库克群岛、萨摩亚的 pate；塔希提叫托埃雷 tōʻere）：一段硬木挖出一条长缝的小裂缝鼓，两根木棍飞快地敲，
// 敲在缝的中间是“托”（pate），靠近两头是更高更干的“迪”（pate_hi）——奥特阿（ʻōteʻa）鼓舞里滚个不停的十六分音符。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const PATE: RegionalDef = {
  region: "pacific",
  name: { zh: "帕特裂缝鼓（托埃雷）", en: "Pate / tōʻere (slit drum)" },
  drums: {
    pate: { layers: [skin(760, 735, 0.006, 0.12, 0.9, [[1.92, 0.3, 0.05], [3.3, 0.14, 0.03]], 0.0004), hiss(1600, 7000, 0.005, 0.5, { attack: 0.0006 })] },
    pate_hi: { layers: [skin(1080, 1050, 0.005, 0.09, 0.85, [[2.05, 0.28, 0.04]], 0.0004), hiss(2000, 8000, 0.005, 0.5, { attack: 0.0006 })] },
  },
  // 十六分音符的“滚”：托 · 迪托 · 迪托 · 托 · 迪托 · 迪迪迪
  demo: { key: "C major", qpm: 110, bars: 3, drum: [{ grid: 0.5, steps: "T.hT.hT.T.hT.hhhT.hT.hT.ThhT.hhhT.hT.hT.T.hTThhh", hits: { T: ["pate", 0.9], h: ["pate_hi", 0.7] } }] },
};
