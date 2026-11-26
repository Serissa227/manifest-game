// 巴本迪尔（babendil，马京达瑙的平顶锣）：乳头凹进去的一只小锣，用细竹棍敲它的边，“叮、叮”的又尖又亮——锣乐队里的“拍子”，从头到尾不停。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const BABENDIL: RegionalDef = {
  region: "philippines",
  name: { zh: "巴本迪尔（平顶锣）", en: "Babendil" },
  drums: {
    babendil: { layers: [skin(1180, 1180, 0.01, 0.35, 0.8, [[1.71, 0.5, 0.25], [2.53, 0.35, 0.18], [3.8, 0.2, 0.1]], 0.0004), hiss(2500, 9000, 0.02, 0.6, { attack: 0.0008 })], vary: 0.01 },
    babendil_mute: { layers: [skin(1180, 1180, 0.01, 0.06, 0.7, [[1.71, 0.45, 0.05], [2.53, 0.3, 0.04]], 0.0004), hiss(2500, 9000, 0.015, 0.7, { attack: 0.0008 })], vary: 0.01 },
  },
  demo: { key: "C major", qpm: 120, bars: 3, drum: [{ steps: "b.mbb.mbb.mbb.mbb.mbb.mb", hits: { b: ["babendil", 0.8], m: ["babendil_mute", 0.7] } }] },
};
