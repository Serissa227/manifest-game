// 谢凯雷（西非的葫芦沙铃）：一个大葫芦外面罩着串满珠子（或种子、贝壳）的网，一抖网、珠子打在葫芦上“唰”，
// 手掌拍葫芦底是低低的“嘭”。约鲁巴与曼丁的鼓队里都有，一直推着十六分音符走。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const SHEKERE: RegionalDef = {
  region: "guinea",
  name: { zh: "谢凯雷（葫芦珠网沙铃）", en: "Shekere" },
  drums: {
    shekere: { layers: [hiss(1500, 7000, 0.08, 1, { attack: 0.006, taps: 5 })] },
    shekere_soft: { layers: [hiss(2000, 7500, 0.05, 0.55, { attack: 0.008, taps: 3 })] },
    shekere_bass: { layers: [skin(140, 118, 0.02, 0.16, 0.7), hiss(1500, 6000, 0.06, 0.6, { attack: 0.004, taps: 3 })] },
  },
  demo: { key: "C major", qpm: 104, bars: 3, drum: [{ grid: 0.5, steps: "B.sSs.sSB.sSs.sSB.sSs.sSB.sSs.sSB.sSs.sSB.sSsSsS", hits: { B: ["shekere_bass", 0.8], S: ["shekere", 0.75], s: ["shekere_soft", 0.55] } }] },
};
