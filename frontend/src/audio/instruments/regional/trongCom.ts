// 饭鼓（trống cơm，大越的两面长鼓）：鼓面中心糊一团熟米饭调音，所以手拍下去“通”的一声有清楚的音高；小面拍击是“嗒”。
// 节庆与乡里的丝竹乐里跟着旋律走。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const TRONG_COM: RegionalDef = {
  region: "vietnam",
  name: { zh: "饭鼓", en: "Trống cơm" },
  drums: {
    trong_com: { layers: [skin(190, 178, 0.02, 0.55, 1, [[2.0, 0.3, 0.3], [3.0, 0.12, 0.15]], 0.0008), hiss(200, 1500, 0.02, 0.3, { attack: 0.0008 })], vary: 0.015 },
    trong_com_tac: { layers: [skin(420, 400, 0.01, 0.07, 0.6, undefined, 0.0006), hiss(1500, 7000, 0.015, 0.8, { attack: 0.0006 })] },
  },
  demo: { key: "C major", qpm: 96, bars: 3, drum: [{ steps: "T..t.T.tT..t.TtT.T.t.Tt.", hits: { T: ["trong_com", 0.85], t: ["trong_com_tac", 0.7] } }] },
};
