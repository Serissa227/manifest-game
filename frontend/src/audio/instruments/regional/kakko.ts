// 羯鼓（日本雅乐，kakko）：放在架上的小双面鼓，两根细槌，整个合奏由它领着走——
// “正”（sei，kakko）是一下干脆的“咚”；“来”（rai，kakko_rai）是滚奏里的一下，更轻、更短：片来（katarai，一只手越打越快）
// 与诸来（morarai，两只手交替越打越快）都由一串“来”组成，曲谱里写成越来越密的格子（grid 0.25）。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const KAKKO: RegionalDef = {
  region: "japan",
  name: { zh: "羯鼓", en: "Kakko" },
  drums: {
    kakko: { layers: [skin(560, 500, 0.008, 0.16, 1, [[1.59, 0.35, 0.08], [2.14, 0.22, 0.05], [2.65, 0.12, 0.04]], 0.0005), hiss(1400, 7000, 0.016, 0.5, { attack: 0.0012 })] },
    kakko_rai: { layers: [skin(610, 560, 0.006, 0.08, 0.8, [[1.59, 0.3, 0.05], [2.14, 0.18, 0.04]], 0.0005), hiss(1800, 8000, 0.01, 0.45, { attack: 0.001 })] },
  },
  // 片来（越来越密）落到“正”，再一个诸来
  demo: {
    key: "C major",
    qpm: 60,
    bars: 3,
    drum: [
      {
        grid: 0.25,
        steps: "r...r...r..r..r.r.rrrrK........." + "r...r..r..r.r.rrrrrK............" + "K.......r...r..r.r.rrrrrrK......",
        hits: { r: ["kakko_rai", 0.55], K: ["kakko", 0.9] },
      },
    ],
  },
};
