// 缔太鼓（日本）：用绳子绷得很紧的小鼓，高、脆的“嗒嗒”，祭囃子与能乐里给拍子。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const SHIME: RegionalDef = {
  region: "japan",
  name: { zh: "缔太鼓", en: "Shime-daiko" },
  drums: {
    shime: { layers: [skin(520, 430, 0.008, 0.18, 1, [[1.59, 0.3, 0.1], [2.14, 0.2, 0.07]]), hiss(1500, 7000, 0.02, 0.5)] },
  },
  demo: { key: "C major", qpm: 104, bars: 4, drum: [{ steps: "S.s.S.ssS.s.SsS.", hits: { S: ["shime", 0.9], s: ["shime", 0.5] } }] },
};
