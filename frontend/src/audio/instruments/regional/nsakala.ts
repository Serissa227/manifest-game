// 恩萨卡拉（刚果的编筐沙铃）：藤条编的小筐里装着种子或碎石，握着把一抖“唰”——鼓乐里一直沙沙地铺着八分音符。
import { hiss } from "./shape";
import type { RegionalDef } from "./types";

export const NSAKALA: RegionalDef = {
  region: "kongo",
  name: { zh: "恩萨卡拉（编筐沙铃）", en: "Nsakala (basket rattle)" },
  drums: {
    nsakala: { layers: [hiss(2200, 8500, 0.07, 1, { attack: 0.012, taps: 4 })] },
    nsakala_soft: { layers: [hiss(2600, 9000, 0.05, 0.55, { attack: 0.015, taps: 3 })] },
  },
  demo: { key: "C major", qpm: 132, bars: 3, drum: [{ steps: "S.sS.sS.sS.sS.sS.sS.sSss", hits: { S: ["nsakala", 0.8], s: ["nsakala_soft", 0.6] } }] },
};
