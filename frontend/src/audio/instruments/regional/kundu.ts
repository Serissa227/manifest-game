// 昆杜鼓（美拉尼西亚、新几内亚的 kundu）：沙漏形的木鼓，一头蒙蜥蜴皮，皮上粘几粒蜂蜡调音，一只手提着、一只手打——
// 鼓心是会“唱”的一声（分音带着音高、余音长），手掌拍边是亮的“啪”（kundu_slap）。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const KUNDU: RegionalDef = {
  region: "pacific",
  name: { zh: "昆杜沙漏鼓", en: "Kundu (hourglass drum)" },
  drums: {
    kundu: { layers: [skin(235, 198, 0.02, 0.45, 1, [[1.5, 0.35, 0.25], [2.05, 0.22, 0.15], [2.7, 0.1, 0.08]], 0.0008), hiss(400, 2500, 0.015, 0.3)] },
    kundu_slap: { layers: [skin(360, 330, 0.01, 0.12, 0.6, [[1.6, 0.3, 0.05]], 0.0005), hiss(1500, 6500, 0.025, 0.75)] },
  },
  demo: { key: "C major", qpm: 100, bars: 3, drum: [{ steps: "K.s.K.sKK.s.KsK.K.s.KKs.", hits: { K: ["kundu", 0.9], s: ["kundu_slap", 0.7] } }] },
};
