// 凯贝罗鼓（埃塞俄比亚）：两面蒙皮的大鼓，挂在脖子上用手打——大的一面“咚”（鼓心，低而长），小的一面“嗒”（亮），
// 手掌在鼓边一拍“啪”。教堂里与西斯特鼓（铃架）一起伴着祈祷的歌，世俗的歌舞里打 6/8 的“奇克奇卡”（chik-chika）。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const KEBERO: RegionalDef = {
  region: "ethiopia",
  name: { zh: "凯贝罗鼓", en: "Kebero" },
  drums: {
    kebero_dum: { layers: [skin(96, 72, 0.04, 0.75, 1, [[1.55, 0.25, 0.3], [2.1, 0.12, 0.2]]), hiss(80, 600, 0.05, 0.35)] },
    kebero_ta: { layers: [skin(240, 212, 0.015, 0.26, 0.8, [[1.6, 0.3, 0.12], [2.25, 0.15, 0.08]]), hiss(1200, 5000, 0.02, 0.5)] },
    kebero_slap: { layers: [skin(300, 262, 0.008, 0.08, 0.4), hiss(1500, 7000, 0.03, 0.9)] },
  },
  // 6/8 的“奇克奇卡”：咚 · 嗒 咚 嗒 ·，第二小节加一下啪
  demo: {
    key: "C major",
    qpm: 120,
    bars: 3,
    drum: [{ steps: "D.tDt.D.tDtsD.tDt.D.tDDs", hits: { D: ["kebero_dum", 0.85], t: ["kebero_ta", 0.7], s: ["kebero_slap", 0.65] } }],
  },
};
