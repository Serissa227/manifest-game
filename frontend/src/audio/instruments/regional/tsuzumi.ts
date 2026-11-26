// 小鼓（日本，扛在右肩上的沙漏形鼓）：手掌打下去，左手捏着绳子——“噗——”（pon）音高往下一沉，带空的共鸣；
// 干、短的“哒”（ta）是另一种打法。能乐与长呗里与拍子木、太鼓一起。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const TSUZUMI: RegionalDef = {
  region: "japan",
  name: { zh: "小鼓", en: "Kotsuzumi" },
  drums: {
    tsuzumi_pon: { layers: [skin(330, 270, 0.06, 0.5, 1, [[1.5, 0.25, 0.25], [2.0, 0.2, 0.2]]), hiss(600, 3000, 0.015, 0.4)] },
    tsuzumi_ta: { layers: [skin(700, 650, 0.01, 0.06, 0.6), hiss(2000, 8000, 0.02, 0.9)] },
  },
  // 留白多：噗 · · · 哒 · · · | · · 噗 · · · · ·
  demo: { key: "C major", qpm: 80, bars: 3, drum: [{ steps: "P...t.......P...t.P.....", hits: { P: ["tsuzumi_pon", 0.9], t: ["tsuzumi_ta", 0.8] } }] },
};
