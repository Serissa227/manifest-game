// 达布卡（奥斯曼与阿拉伯的杯形鼓，新的一组鼓点）：鼓心的“咚”（doum）深，鼓边的“嗒”（tek）带铝鼓身的金属余响，左手的轻击“卡”（ka）。
// 旧的 doum / tek / ka 不动（别的曲子在用）。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const DARBUKA: RegionalDef = {
  region: "ottoman",
  name: { zh: "达布卡", en: "Darbuka" },
  drums: {
    darb_doum: { layers: [skin(130, 95, 0.015, 0.5, 1, [[1.6, 0.25, 0.25], [2.3, 0.12, 0.12]]), hiss(150, 1000, 0.03, 0.25)] },
    darb_tek: { layers: [skin(760, 740, 0.01, 0.12, 0.5, [[1.53, 0.4, 0.1], [2.31, 0.3, 0.08], [3.1, 0.2, 0.06]]), hiss(3000, 10000, 0.03, 0.9)] },
    darb_ka: { layers: [skin(700, 690, 0.01, 0.06, 0.3, [[1.53, 0.3, 0.05]]), hiss(2500, 9000, 0.02, 0.6)] },
  },
  // 马克苏姆：咚 嗒 · 嗒 咚 · 嗒 ·，中间加花
  demo: { key: "C major", qpm: 100, bars: 3, drum: [{ steps: "DT.TD.T.DTkTDkTkDT.TDDTT", hits: { D: ["darb_doum", 0.9], T: ["darb_tek", 0.75], k: ["darb_ka", 0.5] } }] },
};
