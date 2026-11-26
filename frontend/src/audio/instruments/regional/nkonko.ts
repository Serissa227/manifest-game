// 恩孔科（刚果的裂缝木鼓，nkonko）：整段树干掏空，顶上开一道长缝，缝的两边一厚一薄、敲出一高一低两个音；
// 木槌敲，声音是空心木头的“笃”“托”，能传得很远——报信、召集，也在鼓乐里打骨架。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const NKONKO: RegionalDef = {
  region: "kongo",
  name: { zh: "恩孔科（裂缝木鼓）", en: "Nkonko (slit drum)" },
  drums: {
    nkonko_hi: { layers: [skin(296, 290, 0.008, 0.32, 1, [[2.4, 0.22, 0.08], [3.9, 0.07, 0.04]], 0.0004), hiss(800, 3000, 0.008, 0.4)], vary: 0.01 },
    nkonko_lo: { layers: [skin(212, 207, 0.008, 0.4, 1, [[2.35, 0.22, 0.09], [3.8, 0.07, 0.04]], 0.0004), hiss(600, 2500, 0.008, 0.4)], vary: 0.01 },
  },
  demo: { key: "C major", qpm: 120, bars: 3, drum: [{ steps: "L.h.L.hhL.h.L..hL.h.LhLh", hits: { h: ["nkonko_hi", 0.8], L: ["nkonko_lo", 0.85] } }] },
};
