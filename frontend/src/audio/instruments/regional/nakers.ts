// 小定音鼓（nakers / naccheroni，中世纪到文艺复兴）：一对挂在腰上的小铜鼓（从萨拉森人那里传来的 naqqara），硬槌敲，
// 有音高（高的一只约 270 Hz、低的约 180 Hz），余音短；跟肖姆管与萨克布一起是城里与节庆的“高音乐队”的鼓。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const NAKERS: RegionalDef = {
  region: "iberia_italy",
  name: { zh: "小定音鼓", en: "Nakers" },
  drums: {
    naker_hi: { layers: [skin(300, 268, 0.02, 0.32, 1, [[1.5, 0.35, 0.22], [1.99, 0.22, 0.16], [2.44, 0.1, 0.1]], 0.0008), hiss(300, 2500, 0.025, 0.35, { attack: 0.0015 })] },
    naker_lo: { layers: [skin(205, 180, 0.025, 0.42, 1, [[1.5, 0.35, 0.28], [1.99, 0.2, 0.2]], 0.0008), hiss(200, 2000, 0.03, 0.35, { attack: 0.0015 })] },
  },
  demo: { key: "C major", qpm: 100, bars: 3, drum: [{ steps: "L..hL.h.L..hL.hhL.hhL.L.", hits: { L: ["naker_lo", 0.85], h: ["naker_hi", 0.7] } }] },
};
