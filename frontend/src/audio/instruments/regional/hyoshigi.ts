// 拍子木（日本）：两块硬木对击，“咔”地一声很亮，带一点木头的共鸣——歌舞伎开幕、夜巡的“火の用心”。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const HYOSHIGI: RegionalDef = {
  region: "japan",
  name: { zh: "拍子木", en: "Hyōshigi" },
  drums: {
    hyoshigi: { layers: [skin(2300, 2250, 0.01, 0.09, 0.8, [[1.48, 0.5, 0.06], [2.6, 0.25, 0.04]], 0.0006), skin(900, 880, 0.01, 0.04, 0.35, undefined, 0.0006), hiss(2500, 9000, 0.006, 0.6, { attack: 0.0015 })] },
  },
  // 越敲越密（开幕的“柝の頭”）
  demo: { key: "C major", qpm: 90, bars: 3, drum: [{ steps: "h.......h...h.h.h.hhhhhh", hits: { h: ["hyoshigi", 0.85] } }] },
};
