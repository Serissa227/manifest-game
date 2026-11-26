// 腰铃（满语 siša，萨满的腰铃）：一条皮带上挂着几十个铁皮卷成的锥形铃，萨满扭腰一甩，铃子互相撞成一大片“哗——啷”，
// 先涌起来、再散开（sisa）；轻轻一抖是短的“沙啦”（sisa_shake）。跳神的声音一半是鼓、一半是它。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const SISA: RegionalDef = {
  region: "jurchen",
  name: { zh: "腰铃（萨满）", en: "Siša (waist bells)" },
  drums: {
    sisa: {
      layers: [
        hiss(2200, 9500, 0.5, 1, { attack: 0.035, taps: 12 }),
        hiss(900, 3500, 0.25, 0.4, { attack: 0.02, taps: 8 }),
        // 铁锥自己的叮当（不协和的几个分音）
        skin(2900, 2900, 0.01, 0.35, 0.18, [[1.37, 0.8, 0.3], [1.81, 0.6, 0.25], [2.42, 0.5, 0.2]], 0.002),
      ],
    },
    sisa_shake: { layers: [hiss(2500, 9500, 0.15, 1, { attack: 0.01, taps: 6 }), skin(3100, 3100, 0.01, 0.1, 0.15, [[1.4, 0.7, 0.08]], 0.002)] },
  },
  // 甩一下 · · 抖 · · | 甩 · 抖 甩 · ·
  demo: { key: "C major", qpm: 100, bars: 3, drum: [{ steps: "S..s..S.sS..", hits: { S: ["sisa", 0.85], s: ["sisa_shake", 0.6] } }] },
};
