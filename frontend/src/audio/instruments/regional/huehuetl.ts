// 韦韦特尔（阿兹特克的立鼓）：一段直立的高大空心木头（齐腰到齐胸），下面刻出三只脚，上面蒙着美洲豹皮或鹿皮，用手掌打——
// 鼓心是低沉、拖得很长的“咚”（huehuetl），手指打鼓边是干的“嗒”（huehuetl_ti）。比玛雅的帕克斯鼓更大、更低，余音更长。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const HUEHUETL: RegionalDef = {
  region: "mexica",
  name: { zh: "韦韦特尔鼓", en: "Huehuetl" },
  drums: {
    huehuetl: { layers: [skin(105, 72, 0.045, 0.95, 1, [[1.52, 0.3, 0.45], [2.03, 0.16, 0.3], [2.6, 0.08, 0.18]], 0.0008), hiss(55, 280, 0.14, 0.42), hiss(500, 2400, 0.02, 0.16, { attack: 0.002 })] },
    huehuetl_ti: { layers: [skin(360, 340, 0.01, 0.12, 0.7, [[1.6, 0.3, 0.06]], 0.0004), hiss(1200, 5500, 0.025, 0.65, { attack: 0.0015 })] },
  },
  // 咚 · 嗒嗒 · 咚 · 嗒 · 嗒（2 + 3 + 2 + 3 的“toco tiquiti”）
  demo: { key: "C major", qpm: 100, bars: 3, drum: [{ steps: "H.tt.H.t.tH.tt.H.t.tH...", hits: { H: ["huehuetl", 0.9], t: ["huehuetl_ti", 0.6] } }] },
};
