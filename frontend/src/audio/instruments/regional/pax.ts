// 帕克斯鼓（玛雅的立鼓，阿兹特克叫韦韦特尔）：一段直立的空心木头蒙着鹿皮，手打——低的“咚”与掌拍。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const PAX: RegionalDef = {
  region: "maya",
  name: { zh: "帕克斯鼓", en: "Pax drum" },
  drums: {
    pax: { layers: [skin(140, 95, 0.03, 0.4, 1, [[1.6, 0.2, 0.15]]), hiss(150, 1200, 0.03, 0.3)] },
    pax_slap: { layers: [skin(330, 320, 0.01, 0.08, 0.6), hiss(1500, 6000, 0.03, 0.8)] },
  },
  demo: { key: "C major", qpm: 100, bars: 3, drum: [{ steps: "P..s.P.sP..s.PssP..s.P.s", hits: { P: ["pax", 0.9], s: ["pax_slap", 0.7] } }] },
};
