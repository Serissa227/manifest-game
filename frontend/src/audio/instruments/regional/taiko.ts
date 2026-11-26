// 太鼓（日本的长胴太鼓）：两根粗槌打在牛皮的中央“咚”（don），鼓身是一整段挖空的树干，低音厚、余音长；
// 打鼓边是“咔”（ka）。轻重两种“咚”用力度区分（重的一下、轻的“咚哒”的第二下）。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const TAIKO: RegionalDef = {
  region: "japan",
  name: { zh: "太鼓", en: "Taiko" },
  drums: {
    taiko_don: { layers: [skin(115, 68, 0.035, 1.2, 1, [[1.5, 0.32, 0.5], [1.98, 0.2, 0.35], [2.44, 0.12, 0.22], [2.9, 0.07, 0.15]]), hiss(300, 2400, 0.025, 0.3), hiss(50, 250, 0.15, 0.45)] },
    taiko_ka: { layers: [skin(1900, 1850, 0.01, 0.05, 0.6, [[1.37, 0.4, 0.04], [2.2, 0.2, 0.03]]), hiss(1200, 6000, 0.012, 0.6)] },
  },
  // 咚 · 咚哒 咚 · · · | 咚 · 咚 · 咔 · 咔 ·
  demo: { key: "C major", qpm: 100, bars: 4, drum: [{ steps: "D..dD...D.D.k.k.", hits: { D: ["taiko_don", 0.95], d: ["taiko_don", 0.5], k: ["taiko_ka", 0.7] } }] },
};
