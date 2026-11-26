// 大太鼓（エイサーの太鼓，琉球）：盂兰盆的“エイサー”里，舞者把大鼓挂在身侧，边跳边用一根鼓槌打——
// 比日本的长胴太鼓短、亮一些的“咚”（eisa_don），打鼓边是“咔”（eisa_rim）。与缔太鼓、手鼓（パーランクー）一起。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const EISA_DAIKO: RegionalDef = {
  region: "ryukyu",
  name: { zh: "大太鼓（エイサー）", en: "Eisa ōdaiko" },
  drums: {
    eisa_don: { layers: [skin(130, 85, 0.03, 0.8, 1, [[1.5, 0.3, 0.4], [2.0, 0.18, 0.25], [2.6, 0.1, 0.15]], 0.0008), hiss(300, 2500, 0.02, 0.35, { attack: 0.0015 }), hiss(50, 250, 0.12, 0.35)] },
    eisa_rim: { layers: [skin(1700, 1650, 0.01, 0.05, 0.6, [[1.4, 0.35, 0.03]], 0.0005), hiss(1500, 7000, 0.01, 0.6, { attack: 0.001 })] },
  },
  // 咚 · 咔 咚 · 咔 | 咚 咚 · 咚 · ·
  demo: { key: "C major", qpm: 112, bars: 3, drum: [{ steps: "D.rD.rDD.D..", hits: { D: ["eisa_don", 0.9], r: ["eisa_rim", 0.6] } }] },
};
