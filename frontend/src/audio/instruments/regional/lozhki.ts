// 木勺（罗斯的 lozhki：两三把硬木的勺子背对背夹在手里，拍在膝上与掌心）：干、脆、带一点木头的音高的“嗒”，
// lozhki 是一下，lozhki_roll 是勺子在指间抖出的一串“嗒啦啦”。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const LOZHKI: RegionalDef = {
  region: "north_europe",
  name: { zh: "木勺", en: "Lozhki (wooden spoons)" },
  drums: {
    lozhki: { layers: [skin(1850, 1800, 0.01, 0.045, 0.75, [[1.43, 0.45, 0.03], [2.31, 0.25, 0.02]], 0.001), hiss(1500, 6000, 0.012, 0.6, { attack: 0.0026 })] },
    lozhki_roll: { layers: [skin(1750, 1700, 0.01, 0.05, 0.55, [[1.43, 0.4, 0.03]], 0.001), hiss(1400, 6000, 0.03, 0.75, { attack: 0.0026, taps: 4 })] },
  },
  // 舞曲的碎拍
  demo: { key: "C major", qpm: 120, bars: 4, drum: [{ steps: "L.lLR.lLL.lLR.R.", grid: 0.5, hits: { L: ["lozhki", 0.85], l: ["lozhki", 0.5], R: ["lozhki_roll", 0.8] } }] },
};
