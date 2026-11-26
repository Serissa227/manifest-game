// 普纽（夏威夷的 pūniu，膝鼓）：半个椰子壳蒙上鱼皮（kala），绑在大腿上，用一条编起来的绳子（kā）抽打——
// 高、紧、短，绳子抽下去带一点“啪啦”。跟着帕胡鼓，在大鼓的空当里点几下。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const PUNIU: RegionalDef = {
  region: "pacific",
  name: { zh: "普纽膝鼓", en: "Pūniu (knee drum)" },
  drums: {
    puniu: { layers: [skin(560, 500, 0.008, 0.11, 0.8, [[1.6, 0.4, 0.05], [2.35, 0.2, 0.03]], 0.0005), hiss(1500, 8000, 0.015, 0.75, { attack: 0.0008, taps: 2 })] },
  },
  // 十六分音符的格子
  demo: { key: "C major", qpm: 96, bars: 3, drum: [{ grid: 0.5, steps: "x...x.x.x...xxx.x...x.x.x.x.xxx.x...x.x.x...x...", hits: { x: ["puniu", 0.85] } }] },
};
