// 手鼓（パーランクー，琉球）：巴掌大的单面框鼓，一手拿着、一手用细槌打，干、高、短的“啪”——エイサー里成排的舞者打着它跳。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const PARANKU: RegionalDef = {
  region: "ryukyu",
  name: { zh: "手鼓（パーランクー）", en: "Pāranku" },
  drums: {
    paranku: { layers: [skin(420, 360, 0.01, 0.14, 1, [[1.59, 0.35, 0.07], [2.14, 0.2, 0.05]], 0.0004), hiss(1200, 6000, 0.03, 0.55, { attack: 0.0006 })] },
  },
  demo: { key: "C major", qpm: 112, bars: 3, drum: [{ steps: "P.pP.pP.pPpp", hits: { P: ["paranku", 0.85], p: ["paranku", 0.5] } }] },
};
