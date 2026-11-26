// 卡拉阿乌（夏威夷的 kālāʻau，节奏棒；密克罗尼西亚的棍舞也是两根硬木棍对击）：一长一短两根硬木，
// 短的敲长的——干、亮、比拍子木低一点、短一点的“哒”。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const KALAAU: RegionalDef = {
  region: "pacific",
  name: { zh: "卡拉阿乌节奏棒", en: "Kālāʻau (rhythm sticks)" },
  drums: {
    kalaau: { layers: [skin(1350, 1330, 0.006, 0.08, 0.8, [[2.45, 0.3, 0.04], [4.1, 0.12, 0.02]], 0.0005), hiss(1800, 8000, 0.005, 0.45, { attack: 0.0006 })] },
  },
  demo: { key: "C major", qpm: 96, bars: 3, drum: [{ steps: "k.k.kk.kk.k.kk.kk.kkk.k.", hits: { k: ["kalaau", 0.8] } }] },
};
