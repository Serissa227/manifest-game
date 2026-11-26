// 刚果的恩戈马鼓：高高的单面鼓，立在地上或斜夹在腿间用手打——鼓心的低音“咚”、鼓边的“通”（开放的音）、
// 手掌在鼓边一抽的“啪”。几只大小不同的鼓各打各的型，叠起来是 3 对 2 的交错（12/8 拍）。
// 与斯瓦希里海岸的恩戈马（姆松多、恰普奥）分开登记：音色更开、更圆，有“通”与“啪”两种手法。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const NGOMA_KONGO: RegionalDef = {
  region: "kongo",
  name: { zh: "恩戈马鼓（刚果）", en: "Ngoma (Kongo)" },
  drums: {
    ngoma_kongo: { layers: [skin(112, 82, 0.03, 0.55, 1, [[1.58, 0.22, 0.22]]), hiss(100, 900, 0.03, 0.35)] },
    ngoma_kongo_tone: { layers: [skin(212, 196, 0.012, 0.3, 0.9, [[1.6, 0.3, 0.15], [2.3, 0.12, 0.08]]), hiss(800, 4000, 0.012, 0.35)] },
    ngoma_kongo_slap: { layers: [skin(320, 300, 0.006, 0.07, 0.45), hiss(1800, 8000, 0.03, 0.9)] },
  },
  // 12/8：咚 · · 通 · 通 咚 · 啪 通 · 通
  demo: {
    key: "C major",
    qpm: 132,
    bars: 3,
    drum: [{ steps: "B..t.tB.st.tB..t.tB.stst", hits: { B: ["ngoma_kongo", 0.85], t: ["ngoma_kongo_tone", 0.7], s: ["ngoma_kongo_slap", 0.7] } }],
  },
};
