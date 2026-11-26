// 堂鼓（明）：中等的双面鼓，鼓槌打下去“咚”，音高往下走一点；锣鼓里推气势，也给号子打拍子。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const TANGGU: RegionalDef = {
  region: "ming",
  name: { zh: "堂鼓", en: "Tanggu" },
  drums: {
    tanggu: { layers: [skin(210, 150, 0.02, 0.5, 1, [[1.59, 0.3, 0.2], [2.14, 0.15, 0.12]], 0.0008), hiss(400, 3000, 0.02, 0.4, { attack: 0.002 })] },
  },
  demo: { key: "C major", qpm: 100, bars: 3, drum: [{ steps: "T.t.T.t.TTt.T...T.T.tttt", hits: { T: ["tanggu", 0.9], t: ["tanggu", 0.5] } }] },
};
