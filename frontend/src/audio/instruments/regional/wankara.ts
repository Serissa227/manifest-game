// 万卡拉（安第斯高原艾马拉人的大鼓）：双面的大鼓，用一根槌敲；鼓面上横绷着一两根羊肠弦（chirlera），
// 一敲就跟着“嗞——”地嗡一阵——这是它与邦博鼓（毛皮、闷、圆）最不一样的地方。敲鼓框是“嗒”（wankara_rim）。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const WANKARA: RegionalDef = {
  region: "andes",
  name: { zh: "万卡拉大鼓", en: "Wankara" },
  drums: {
    wankara: { layers: [skin(88, 58, 0.05, 0.8, 1, [[1.55, 0.3, 0.35], [2.2, 0.15, 0.2]], 0.0008), hiss(60, 300, 0.12, 0.4, { attack: 0.002 }), hiss(1500, 5500, 0.45, 0.2, { attack: 0.004, taps: 4 })] },
    wankara_rim: { layers: [skin(1100, 1080, 0.005, 0.04, 0.6, undefined, 0.0003), hiss(2000, 7000, 0.005, 0.45, { attack: 0.0015 })] },
  },
  // 瓦伊诺的“长 — 短短”：嘭 · 嘭嘭 嘭 · 嗒 ·
  demo: { key: "C major", qpm: 100, bars: 3, drum: [{ steps: "W.wwW.r.", hits: { W: ["wankara", 0.85], w: ["wankara", 0.5], r: ["wankara_rim", 0.55] } }] },
};
