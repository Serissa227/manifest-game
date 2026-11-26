// 格隆塔（klong that，暹罗的一对大桶鼓）：斜架在地上，两根木棍打，一只低（“母”）一只略高（“公”），“咚——”地沉；
// piphat 乐队在曲子的段落交界、收尾与“快板”（chan diao）里敲，不常响，一响就满场。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const KLONG_THAT: RegionalDef = {
  region: "siam",
  name: { zh: "格隆塔（大桶鼓）", en: "Klong that" },
  drums: {
    klong_that: { layers: [skin(92, 64, 0.05, 1.1, 1, [[1.52, 0.35, 0.5], [2.0, 0.2, 0.35], [2.5, 0.1, 0.2]], 0.0008), hiss(800, 4000, 0.012, 0.45, { attack: 0.0008 }), hiss(40, 220, 0.18, 0.4, { attack: 0.002 })] },
    klong_that_hi: { layers: [skin(125, 95, 0.04, 0.9, 1, [[1.55, 0.3, 0.4], [2.1, 0.15, 0.25]], 0.0008), hiss(900, 4500, 0.012, 0.45, { attack: 0.0008 }), hiss(60, 300, 0.15, 0.35, { attack: 0.002 })] },
  },
  demo: { key: "C major", qpm: 100, bars: 3, drum: [{ steps: "L.......H...L...L.L.H.LL", hits: { L: ["klong_that", 0.9], H: ["klong_that_hi", 0.85] } }] },
};
