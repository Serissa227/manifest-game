// 纳卡拉（莫卧儿宫门“鼓楼”naqqar khana 里的一对铜壳锅鼓）：大的低沉、小的高而脆，用两根弯木棍敲，连击滚成一片；
// 每天定时与谢赫奈、长号角一起在宫门上奏（naubat），宣告君主在城中——一听就是宫城。
// 鼓点：Dhum（大鼓）、Tak（小鼓）。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const NAQQARA: RegionalDef = {
  region: "india",
  name: { zh: "纳卡拉（宫门锅鼓）", en: "Naqqara" },
  drums: {
    naq_dhum: { layers: [skin(105, 90, 0.02, 0.9, 1, [[1.5, 0.4, 0.5], [1.98, 0.25, 0.4], [2.45, 0.12, 0.3]]), hiss(150, 2000, 0.04, 0.6)] },
    naq_tak: { layers: [skin(420, 380, 0.01, 0.25, 0.8, [[1.5, 0.35, 0.12], [2.0, 0.2, 0.1]]), hiss(1500, 7000, 0.02, 0.8)] },
  },
  // 大鼓起、小鼓滚：咚 · 嗒嗒 嗒 · 咚 · | 嗒嗒嗒嗒嗒嗒 咚 ·
  demo: {
    key: "C minor",
    qpm: 84,
    bars: 4,
    drum: [
      { steps: "D.......D...D.......D.D.D...", hits: { D: ["naq_dhum", 0.85] } },
      { steps: "..tt.t.t..tt..tttttt....tt.t", hits: { t: ["naq_tak", 0.7] } },
    ],
  },
};
