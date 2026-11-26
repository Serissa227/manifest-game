// 廷亚（安第斯的小手鼓）：一面小框鼓，左手提着、右手用一根细槌敲，鼓面上也绷着一根弦（chirlera），一敲就“嗞”一下；
// 放牧节、给羊驼系彩线的“埃拉恩萨”节里多半是女人边唱边敲。比万卡拉高、紧、短。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const TINYA: RegionalDef = {
  region: "andes",
  name: { zh: "廷亚小鼓", en: "Tinya" },
  drums: {
    tinya: { layers: [skin(340, 305, 0.012, 0.18, 0.9, [[1.6, 0.3, 0.08]], 0.0003), hiss(1800, 6000, 0.14, 0.5, { attack: 0.003, taps: 3 })] },
    tinya_soft: { layers: [skin(330, 300, 0.012, 0.14, 0.7, [[1.6, 0.25, 0.06]], 0.0003), hiss(1800, 6000, 0.1, 0.35, { attack: 0.003, taps: 2 })] },
  },
  demo: { key: "C major", qpm: 100, bars: 3, drum: [{ steps: "T.ttT.t.T.ttT.tt", hits: { T: ["tinya", 0.8], t: ["tinya_soft", 0.55] }, grid: 0.5 }] },
};
