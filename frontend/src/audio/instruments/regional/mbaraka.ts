// 姆巴拉卡（巴西图皮南巴人的圣沙铃，葡萄牙人记作 maracá）：大葫芦插在木柄上，里面装着种子和小石子，顶上插着羽毛——
// 巫师（pajé）拿它唱、舞者围成圈一边踏地一边摇。葫芦大，声音比泰诺的马拉卡低、厚，带一点葫芦壳的“空”声（mbaraka）；
// 长长地抖是一阵慢慢起伏的“沙——”（mbaraka_roll，刮奏层，种子成团地撞）。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const MBARAKA: RegionalDef = {
  region: "tupi",
  name: { zh: "姆巴拉卡圣沙铃", en: "Mbaraká (Tupi maracá)" },
  drums: {
    mbaraka: { layers: [hiss(1100, 6500, 0.075, 1, { attack: 0.006, taps: 3 }), skin(330, 300, 0.01, 0.05, 0.3, undefined, 0.001), hiss(400, 1200, 0.03, 0.25, { attack: 0.003 })] },
    mbaraka_roll: { layers: [{ kind: "rasp", lo: 1300, hi: 7000, rate: 28, dur: 0.55, click: 0.03, level: 0.85, jitter: 0.3, floor: 0.45 }] },
  },
  // 每拍一下，重 · 轻 · ，句尾长长地抖
  demo: { key: "C major", qpm: 112, bars: 3, drum: [{ steps: "M.m.M.m.M.m.M.m.M.m.R...", hits: { M: ["mbaraka", 0.85], m: ["mbaraka", 0.5], R: ["mbaraka_roll", 0.75] } }] },
};
