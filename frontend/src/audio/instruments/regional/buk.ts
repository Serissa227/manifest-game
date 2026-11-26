// 鼓（북，朝鲜）：桶形的木鼓身、厚牛皮，盘索里的鼓手（고수）一手拍皮、一手用鼓槌打——皮上是低沉的“咚”，
// 槌打在木头鼓身（북통）上是干脆的“哒”；农乐里背着打，给长短落拍。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const BUK: RegionalDef = {
  region: "korea",
  name: { zh: "鼓（朝鲜的북）", en: "Buk" },
  drums: {
    buk: { layers: [skin(95, 72, 0.04, 0.6, 1, [[1.5, 0.3, 0.35], [2.0, 0.18, 0.2]], 0.0008), hiss(60, 300, 0.12, 0.35), hiss(500, 2500, 0.02, 0.25, { attack: 0.0015 })] },
    buk_rim: { layers: [skin(1400, 1350, 0.01, 0.06, 0.7, [[1.45, 0.4, 0.04]], 0.0005), skin(420, 400, 0.01, 0.05, 0.3, undefined, 0.0005), hiss(2000, 7000, 0.008, 0.5, { attack: 0.001 })] },
  },
  // 盘索里的鼓：咚 · · 哒 · 哒 | 咚 · 咚 哒 · ·
  demo: { key: "C major", qpm: 92, bars: 3, drum: [{ steps: "B..r.rB.Br..", hits: { B: ["buk", 0.9], r: ["buk_rim", 0.7] } }] },
};
