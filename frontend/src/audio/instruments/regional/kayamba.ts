// 卡亚姆巴（斯瓦希里海岸，芦苇编的扁沙箱，里面装着种子）：双手捧着前后摇，“唰——唰”。
import { hiss } from "./shape";
import type { RegionalDef } from "./types";

export const KAYAMBA: RegionalDef = {
  region: "swahili",
  name: { zh: "卡亚姆巴沙箱", en: "Kayamba" },
  drums: {
    kayamba: { layers: [hiss(2000, 8000, 0.09, 1, { attack: 0.03, taps: 5 })] },
  },
  demo: { key: "C major", qpm: 108, bars: 3, drum: [{ steps: "K.kK.kK.", hits: { K: ["kayamba", 0.8], k: ["kayamba", 0.45] } }] },
};
