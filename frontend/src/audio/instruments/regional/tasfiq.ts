// 拍手（阿拉伯，“塔斯菲格”）：海湾的采珠船歌（菲吉里）与红海、也门的歌舞里，一群人按节奏型拍手——
// 平掌拍的“啪”亮（1–4 kHz，几个人先后差几毫秒，连成一片）；合拢的空心掌“噗”低而圆（像拍在陶罐口上）。
// 都是一群人，不是一个人：噪声按几下先后相连（taps）。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const TASFIQ: RegionalDef = {
  region: "arabia",
  name: { zh: "拍手（塔斯菲格）", en: "Tasfiq handclaps" },
  drums: {
    tasfiq: { layers: [hiss(800, 4200, 0.055, 1, { taps: 5, attack: 0.0012 }), skin(1300, 1150, 0.006, 0.025, 0.12, undefined, 0.0006)] },
    tasfiq_low: { layers: [hiss(450, 1900, 0.045, 1, { taps: 4, attack: 0.0012 }), skin(620, 540, 0.008, 0.04, 0.25, undefined, 0.0006)] },
  },
  // 海湾的 3 + 3 + 2：平掌与空心掌交替
  demo: { key: "C major", qpm: 96, bars: 4, drum: [{ steps: "P..L..P.P..L..PLP..L..P.P.LL.PP.", hits: { P: ["tasfiq", 0.85], L: ["tasfiq_low", 0.8] } }] },
};
