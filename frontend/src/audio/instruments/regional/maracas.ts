// 马拉卡（加勒比泰诺人的沙槌，“maraca”这个词就是泰诺语）：一对圆葫芦（higüera）里装着种子或小石子，装上木柄，两只一高一低。
// 往前一甩，种子齐齐地撞在葫芦壁上——比玛雅的葫芦沙铃利落、亮，“嚓”的一下就停；两只成对地交替（maraca_hi / maraca_lo）。
import { hiss } from "./shape";
import type { RegionalDef } from "./types";

export const MARACAS: RegionalDef = {
  region: "taino",
  name: { zh: "马拉卡沙槌", en: "Maracas" },
  drums: {
    maraca_hi: { layers: [hiss(3200, 11000, 0.04, 1, { attack: 0.005, taps: 2 }), hiss(1600, 4200, 0.02, 0.3, { attack: 0.004 })], vary: 0.06 },
    maraca_lo: { layers: [hiss(2400, 8500, 0.05, 1, { attack: 0.005, taps: 2 }), hiss(1200, 3500, 0.025, 0.35, { attack: 0.004 })], vary: 0.06 },
  },
  // 两只交替，每拍一对，重音在拍上
  demo: { key: "C major", qpm: 104, bars: 3, drum: [{ steps: "HlhlHlhl", hits: { H: ["maraca_hi", 0.85], h: ["maraca_hi", 0.5], l: ["maraca_lo", 0.55] }, grid: 0.5 }] },
};
