// 木鱼（mõ，大越）：挖空的一块木头，小槌一敲“笃”的一声空而有音高——寺里诵经、村里报时、巡夜都用它。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const MO: RegionalDef = {
  region: "vietnam",
  name: { zh: "木鱼（越南）", en: "Mõ" },
  drums: {
    mo: { layers: [skin(680, 660, 0.01, 0.22, 1, [[2.3, 0.15, 0.06], [3.9, 0.06, 0.03]], 0.0005), hiss(1200, 5000, 0.008, 0.45, { attack: 0.0008 })], vary: 0.015 },
  },
  demo: { key: "C major", qpm: 90, bars: 3, drum: [{ steps: "m.......m.......m...m...", hits: { m: ["mo", 0.85] } }] },
};
