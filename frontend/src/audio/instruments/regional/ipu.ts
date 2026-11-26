// 伊普（夏威夷的 ipu heke，两只葫芦接成的“双葫芦”）：抱着往垫子上一顿是“库”（kū，葫芦腔的空响，低而短），
// 手掌拍葫芦的侧面是“帕”（pā，亮的一拍）。呼拉的基本节奏 kāholo：库 · 帕帕 库 · 帕帕。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const IPU: RegionalDef = {
  region: "pacific",
  name: { zh: "伊普双葫芦", en: "Ipu heke (gourd drum)" },
  drums: {
    ipu_ku: { layers: [skin(170, 125, 0.015, 0.32, 1, [[2.6, 0.12, 0.05]], 0.0015), hiss(80, 500, 0.04, 0.5, { attack: 0.002 })] },
    ipu_pa: { layers: [skin(330, 300, 0.01, 0.13, 0.7, [[1.85, 0.3, 0.05], [3.2, 0.12, 0.03]], 0.0005), hiss(900, 6000, 0.018, 0.8)] },
  },
  // kāholo 两小节，再一小节变化（库库帕），收在“库 · 帕”
  demo: { key: "C major", qpm: 96, bars: 4, drum: [{ steps: "K.PPK.PPK.PPK.PPK.PPKKP.K.P.K...", hits: { K: ["ipu_ku", 0.9], P: ["ipu_pa", 0.75] } }] },
};
