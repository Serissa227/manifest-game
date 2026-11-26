// 齐尔（zil，梅赫特的大铜钹）：伊斯坦布尔的铜匠锤出来的一对大钹，两片对击“锵——”，比西洋的钹更亮、余音更长，
// 里面带着几个不协和的金属分音，长长地闪；两片一撞立刻合住是短的“嚓”（zil_mute）。军乐在句头、乌苏尔的重拍上击。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const ZIL: RegionalDef = {
  region: "ottoman",
  name: { zh: "齐尔大钹", en: "Zil (mehter cymbals)" },
  drums: {
    zil: {
      layers: [
        hiss(2800, 12500, 2.1, 1, { attack: 0.007 }),
        hiss(700, 3200, 0.6, 0.38, { attack: 0.005 }),
        // 钹面的金属分音（不协和，慢慢散）
        skin(540, 528, 0.01, 1.6, 0.16, [[1.47, 0.8, 1.4], [2.13, 0.7, 1.2], [2.86, 0.55, 1.0], [3.62, 0.45, 0.8], [4.71, 0.35, 0.6]], 0.002),
      ],
    },
    zil_mute: { layers: [hiss(2500, 10500, 0.1, 1, { attack: 0.002 }), hiss(600, 2800, 0.06, 0.45), skin(540, 528, 0.01, 0.09, 0.14, [[1.47, 0.6, 0.08], [2.13, 0.5, 0.07]])] },
  },
  // 锵—— · 嚓 · 嚓 | 锵——
  demo: {
    key: "C major",
    qpm: 90,
    bars: 3,
    drum: [{ steps: "Z.......c.c.c...Z.......", hits: { Z: ["zil", 0.85], c: ["zil_mute", 0.7] } }],
  },
};
