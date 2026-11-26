// 阿约约特尔（阿兹特克舞者绑在脚踝上的果壳串）：一串串晒干的硬果壳（ayoyote）挤在一起，舞者每踏一步就“哗啦”一阵——
// 不是沙铃那样的一团“沙”，是几十个硬壳互相碰撞的一阵密密的“咔啦啦”（刮奏层，间隔抖得很乱），头上一点亮的碎响。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const AYOYOTL: RegionalDef = {
  region: "mexica",
  name: { zh: "阿约约特尔果壳串", en: "Ayoyotl (seed-shell rattles)" },
  drums: {
    ayoyotl: { layers: [{ kind: "rasp", lo: 1300, hi: 6500, rate: 95, dur: 0.13, click: 0.006, level: 1, jitter: 0.45, floor: 0.2 }, hiss(3500, 10000, 0.02, 0.3, { attack: 0.003 }), skin(2300, 2250, 0.004, 0.03, 0.18, undefined, 0.001)] },
    ayoyotl_soft: { layers: [{ kind: "rasp", lo: 1500, hi: 7000, rate: 80, dur: 0.08, click: 0.005, level: 0.8, jitter: 0.45, floor: 0.2 }] },
  },
  // 踏步：重 · 轻 · · 重 · 轻 · ·
  demo: { key: "C major", qpm: 100, bars: 3, drum: [{ steps: "A.a..A.a..A.a..A.a..A...", hits: { A: ["ayoyotl", 0.85], a: ["ayoyotl_soft", 0.6] } }] },
};
