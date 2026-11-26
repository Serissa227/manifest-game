// 纳卡雷（nakkare，梅赫特的一对小铜锅鼓）：两只碗大的铜锅绑在一起，用两根细木槌敲，干、脆、有音高；
// 高的一只（nakkare_hi，约 330 Hz）与低的一只（nakkare_lo，约 230 Hz）交替着打乌苏尔，紧的时候是一串滚奏，催着整支军乐往前走。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const NAKKARE: RegionalDef = {
  region: "ottoman",
  name: { zh: "纳卡雷小锅鼓", en: "Nakkare (paired kettledrums)" },
  drums: {
    nakkare_hi: { layers: [skin(345, 330, 0.008, 0.2, 1, [[1.5, 0.32, 0.12], [1.99, 0.18, 0.08], [2.44, 0.08, 0.05]], 0.0004), hiss(1800, 8000, 0.014, 0.45, { attack: 0.0005 })] },
    nakkare_lo: { layers: [skin(240, 228, 0.01, 0.24, 1, [[1.5, 0.3, 0.14], [1.99, 0.16, 0.09]], 0.0004), hiss(1500, 7000, 0.016, 0.4, { attack: 0.0005 })] },
  },
  // 高 · 低高 高 · 低 · ，再一串交替的滚奏
  demo: {
    key: "C major",
    qpm: 100,
    bars: 3,
    drum: [{ steps: "H...l.H.H...l... H...l.H.H...l... HlHlHlHlHlHlH...", grid: 0.5, hits: { H: ["nakkare_hi", 0.85], l: ["nakkare_lo", 0.75] } }],
  },
};
