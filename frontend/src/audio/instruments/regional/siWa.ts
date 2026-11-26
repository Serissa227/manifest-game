// 锡与瓦（si 与 wa，缅甸音乐的“拍子”）：锡是一对小铃钹，“叮”地一响；瓦是竹的响板，“嗒”的一声干。
// 锡落在弱拍、瓦落在强拍（与暹罗的“钦—恰”一样，一句的最后一拍最重），整个乐队跟着它们走。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const SI_WA: RegionalDef = {
  region: "burma",
  name: { zh: "锡与瓦（铃钹与响板）", en: "Si and wa" },
  drums: {
    si: { layers: [skin(3150, 3150, 0.01, 0.9, 0.7, [[1.33, 0.5, 0.7], [2.08, 0.35, 0.5], [2.9, 0.2, 0.3]], 0.0004), hiss(4000, 12000, 0.1, 0.25, { attack: 0.001 })], vary: 0.01 },
    wa: { layers: [skin(820, 800, 0.01, 0.06, 0.6, [[1.7, 0.4, 0.04], [2.6, 0.2, 0.03]], 0.0005), hiss(1200, 6000, 0.012, 0.9, { attack: 0.0008 })] },
  },
  demo: { key: "C major", qpm: 100, bars: 3, drum: [{ steps: "s...w...s...w...s.w.s.w.", hits: { s: ["si", 0.8], w: ["wa", 0.85] } }] },
};
