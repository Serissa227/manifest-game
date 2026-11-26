// 塔蓬（taphon，暹罗的横放的两面鼓）：大面糊着米膏，手掌拍下去“通”的一声低而有音高；小面拍击“啪”，空击“叮”。
// 它是 piphat 乐队的“指挥”，奏每首曲子固定的鼓型（nathap），一圈圈地转，最后一下落在“恰”上。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const TAPHON: RegionalDef = {
  region: "siam",
  name: { zh: "塔蓬（两面鼓）", en: "Taphon" },
  drums: {
    taphon_tup: { layers: [skin(105, 92, 0.03, 0.55, 1, [[1.5, 0.3, 0.3], [2.1, 0.15, 0.2]], 0.0008), hiss(150, 1200, 0.03, 0.35, { attack: 0.0008 })] },
    taphon_pa: { layers: [skin(330, 315, 0.01, 0.08, 0.7, undefined, 0.0006), hiss(1200, 6000, 0.02, 0.8, { attack: 0.0006 })] },
    taphon_ting: { layers: [skin(395, 390, 0.01, 0.4, 1, [[2.0, 0.25, 0.2], [2.9, 0.1, 0.12]], 0.0006), hiss(1000, 5000, 0.012, 0.3, { attack: 0.0006 })], vary: 0.015 },
  },
  // 一圈三小节的鼓型（T 通、p 啪、t 叮）
  demo: { key: "C major", qpm: 100, bars: 3, drum: [{ steps: "t.p.T.p.t.t.T..ptpt.T.T.", hits: { T: ["taphon_tup", 0.9], p: ["taphon_pa", 0.7], t: ["taphon_ting", 0.75] } }] },
};
