// 齐布齐巴（埃塞俄比亚的拍手）：一群人围着歌手与舞者拍手，6/8 的歌舞（埃斯基斯塔的抖肩舞）离不开它；
// 几双手不会完全对齐，所以一下“啪”是几下挨得很近的脆响（taps），频带在 0.9–4 千赫。
import { hiss } from "./shape";
import type { RegionalDef } from "./types";

export const CHEBCHEBBA: RegionalDef = {
  region: "ethiopia",
  name: { zh: "拍手（齐布齐巴）", en: "Chebchebba (hand claps)" },
  drums: {
    chebchebba: { layers: [hiss(900, 4000, 0.05, 1, { attack: 0.0015, taps: 4 }), hiss(2500, 7000, 0.02, 0.35, { attack: 0.001 })] },
    chebchebba_soft: { layers: [hiss(800, 3200, 0.04, 0.6, { attack: 0.002, taps: 3 })] },
  },
  // 6/8：啪 · 啪 啪 · 啪（轻重交替）
  demo: { key: "C major", qpm: 120, bars: 3, drum: [{ steps: "C.cC.cC.cC.cC.cCccC.cC.c", hits: { C: ["chebchebba", 0.8], c: ["chebchebba_soft", 0.6] } }] },
};
