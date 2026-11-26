// 大鼓（日本能乐的“大鼓”，ōtsuzumi / ōkawa）：架在左腿上的沙漏形鼓，鼓皮上台前用炭火烤得干硬，右手戴着硬的指套打——
// “咔—恩！”（otsuzumi）一声又干又亮、几乎没有低音的余响，像木头裂开；轻打（otsuzumi_lt）短一点。能乐里与小鼓（tsuzumi）一高一低地应答，中间留很长的“间”。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const OTSUZUMI: RegionalDef = {
  region: "japan",
  name: { zh: "大鼓（能乐）", en: "Ōtsuzumi" },
  drums: {
    otsuzumi: { layers: [skin(1350, 1250, 0.003, 0.08, 0.75, [[1.45, 0.5, 0.05], [2.05, 0.35, 0.04], [2.7, 0.25, 0.03]], 0.0004), hiss(1800, 9000, 0.035, 1, { attack: 0.0008 }), hiss(500, 1500, 0.02, 0.22, { attack: 0.0008 })] },
    otsuzumi_lt: { layers: [skin(1250, 1180, 0.003, 0.05, 0.6, [[1.45, 0.4, 0.04]], 0.0004), hiss(2000, 9000, 0.02, 0.8, { attack: 0.0008 })] },
  },
  // 留白多：咔 · · · · · 咔 · | · · 咔 · · · · ·
  demo: { key: "C major", qpm: 70, bars: 3, drum: [{ steps: "K.....k.....K.......k...", hits: { K: ["otsuzumi", 0.9], k: ["otsuzumi_lt", 0.7] } }] },
};
