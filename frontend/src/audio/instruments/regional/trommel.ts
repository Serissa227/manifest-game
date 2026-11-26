// 雇佣兵的长鼓（低地与德意志的 trommel / Landsknechttrommel：民兵（schutterij）、汉萨城市的城防队与船上的鼓）：
// 绳索绷紧的高鼓身，两面皮，底面横着响弦——比军鼓（snare）低、厚，“咚嚓”里鼓身的低音占一半；
// trommel 是正击，trommel_rim 是打在鼓框上的一下。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const TROMMEL: RegionalDef = {
  region: "north_europe",
  name: { zh: "长鼓（雇佣兵鼓）", en: "Trommel (Landsknecht drum)" },
  drums: {
    trommel: { layers: [skin(165, 112, 0.03, 0.34, 1, [[1.5, 0.3, 0.18], [2.2, 0.15, 0.1]], 0.0006), hiss(1100, 5200, 0.17, 0.62, { attack: 0.002 })] },
    trommel_rim: { layers: [skin(900, 860, 0.01, 0.04, 0.6, undefined, 0.0004), hiss(2000, 7000, 0.03, 0.5, { attack: 0.001 })] },
  },
  // 行进的鼓：咚 · 嗒 咚 咚 · 嗒 ·
  demo: { key: "C major", qpm: 104, bars: 4, drum: [{ steps: "T.rTT.r.T.rTT.TT", hits: { T: ["trommel", 0.85], r: ["trommel_rim", 0.6] } }] },
};
