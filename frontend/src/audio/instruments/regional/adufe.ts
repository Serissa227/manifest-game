// 阿杜菲方鼓（adufe，葡萄牙与西班牙的方形框鼓；摩尔人传来的 al-duff）：方框两面蒙皮，里面装着豆子或小铃，
// 拇指与手掌打中间是低的“嘭”，手指打边是“嗒”，每一下鼓里的豆子都跟着“沙——”地一阵（比本迪尔的响弦散、碎）。
// 贝拉一带的妇女边唱边打；伊比利亚的节日歌（维兰西科）也用它。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const ADUFE: RegionalDef = {
  region: "iberia_italy",
  name: { zh: "阿杜菲方鼓", en: "Adufe" },
  drums: {
    adufe: { layers: [skin(118, 92, 0.025, 0.4, 1, [[1.62, 0.22, 0.18], [2.3, 0.1, 0.1]]), hiss(200, 900, 0.05, 0.3), hiss(2200, 7500, 0.22, 0.32, { taps: 7 })] },
    adufe_tek: { layers: [skin(340, 320, 0.01, 0.07, 0.45), hiss(2200, 7500, 0.16, 0.38, { taps: 5 }), hiss(3000, 9000, 0.008, 0.35)] },
  },
  // 6/8：嘭 · 嗒 嘭 · 嗒（按 4/4 的格子示范）
  demo: { key: "C major", qpm: 104, bars: 3, drum: [{ steps: "A.tA.ta.tA.tA.ta.tA.tAAt", hits: { A: ["adufe", 0.85], a: ["adufe", 0.5], t: ["adufe_tek", 0.65] } }] },
};
