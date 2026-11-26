// 琴达（喀拉拉的圆筒鼓）：挂在脖子上竖着打，两根弯木棍敲右面薄薄的一层牛皮——尖、亮、带一点“沙”，滚起来像一阵急雨；
// 左面几层厚皮，闷而低。喀拉拉庙会的“琴达乐”（chenda melam）几十面一起敲，配着小钹与号角，从慢到快地推上去。
// 鼓点：Valam（右面，木棍）、Edam（左面，低音）。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const CHENDA: RegionalDef = {
  region: "india",
  name: { zh: "琴达（喀拉拉圆筒鼓）", en: "Chenda" },
  drums: {
    chenda_valam: { layers: [skin(520, 470, 0.006, 0.12, 0.4, [[1.6, 0.45, 0.1], [2.4, 0.35, 0.08]], 0.0003), hiss(1800, 9000, 0.06, 1, { attack: 0.0008 })] },
    chenda_edam: { layers: [skin(110, 90, 0.02, 0.4, 1, [[1.6, 0.15, 0.12]]), hiss(200, 1500, 0.04, 0.5)] },
  },
  // 由疏到密：咚 · 嗒 · 嗒 · 嗒 · | 咚 嗒 嗒 嗒 嗒 嗒 嗒 嗒（第二层十六分音符的滚奏）
  demo: {
    key: "E major",
    qpm: 84,
    bars: 4,
    drum: [
      { steps: "E.......E.......E...E...E.E.E.E.", hits: { E: ["chenda_edam", 0.85] } },
      { steps: "..v...v...v.v.v.vvvvvvvvvvvvvvvv", hits: { v: ["chenda_valam", 0.7] }, grid: 0.5 },
    ],
  },
};
