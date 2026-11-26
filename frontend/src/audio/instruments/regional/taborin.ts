// 小鼓（英格兰与低地 pipe and tabor 的 tabor：挂在吹笛人左臂上、右手一根鼓槌，鼓面上横着一根响弦）：
// 比原有的塔博鼓（tabor）小、高，响弦的“沙”更短更脆；taborin 是正击，taborin_flam 是两下几乎同时的“装饰击”（响弦连响两下），
// taborin_rim 敲鼓框的“嗒”。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const TABORIN: RegionalDef = {
  region: "north_europe",
  name: { zh: "三孔笛的小鼓", en: "Tabor (pipe and tabor)" },
  drums: {
    taborin: { layers: [skin(320, 235, 0.012, 0.13, 0.75, [[1.59, 0.3, 0.06], [2.3, 0.15, 0.04]], 0.0004), hiss(1900, 7000, 0.09, 0.62, { attack: 0.0015 })] },
    taborin_flam: { layers: [skin(330, 240, 0.012, 0.15, 0.85, [[1.59, 0.3, 0.07]], 0.0004), hiss(1900, 7000, 0.11, 0.7, { attack: 0.0015, taps: 2 })] },
    taborin_rim: { layers: [skin(1450, 1400, 0.01, 0.03, 0.5, undefined, 0.0003), hiss(2600, 8500, 0.018, 0.55, { attack: 0.001 })] },
  },
  // 号笛舞的鼓：咚 · 嗒 咚 · 嗒 · 咚咚
  demo: { key: "C major", qpm: 120, bars: 4, drum: [{ steps: "T.rTF.rTT.rT..FF", hits: { T: ["taborin", 0.85], F: ["taborin_flam", 0.9], r: ["taborin_rim", 0.6] } }] },
};
