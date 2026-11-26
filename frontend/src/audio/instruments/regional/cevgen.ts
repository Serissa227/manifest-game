// 杰夫根（çevgen，梅赫特的响杖）：一根长杖顶上挂着新月形的铜架，架上一串小铜铃，举起来一抖“哗啷”——
// 小铃各有自己的高音（几个不协和的分音），连着响好几下；cevgen 是举高一抖（长、亮），cevgen_tap 是落下一顿（短）。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const CEVGEN: RegionalDef = {
  region: "ottoman",
  name: { zh: "杰夫根响杖", en: "Çevgen (jingling staff)" },
  drums: {
    cevgen: {
      layers: [
        hiss(3600, 11500, 0.32, 1, { attack: 0.007, taps: 9 }),
        // 小铜铃：几个高而不协和的分音
        skin(2350, 2340, 0.005, 0.42, 0.3, [[1.33, 0.8, 0.36], [1.78, 0.65, 0.3], [2.41, 0.45, 0.24]], 0.001),
      ],
      vary: 0.08,
    },
    cevgen_tap: { layers: [hiss(4000, 12000, 0.11, 1, { attack: 0.002, taps: 4 }), skin(2350, 2340, 0.005, 0.16, 0.24, [[1.33, 0.7, 0.14], [1.78, 0.5, 0.12]], 0.001)], vary: 0.08 },
  },
  // 一抖 · 顿 · 一抖 · 顿 ·
  demo: {
    key: "C major",
    qpm: 92,
    bars: 3,
    drum: [{ steps: "C...t...C...t.t.C...t...", hits: { C: ["cevgen", 0.85], t: ["cevgen_tap", 0.7] } }],
  },
};
