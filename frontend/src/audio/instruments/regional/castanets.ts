// 响板（castañuelas，西班牙）：两片硬木的贝壳拴在拇指上，一碰“嗒”；左手的一对低一点（macho），右手的一对高（hembra），
// 右手四个指头依次一滚是“哒啦啦啦”（carretilla）。声音几乎全在 1.5 kHz 以上，短得只有几十毫秒。
// 原有的 clapper（梆子，经典世界在用）是一块木头：更高、只有一下。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const CASTANETS: RegionalDef = {
  region: "iberia_italy",
  name: { zh: "响板", en: "Castanets" },
  drums: {
    castanet: { layers: [skin(2350, 2300, 0.004, 0.035, 0.6, [[1.47, 0.6, 0.025], [2.1, 0.35, 0.018]], 0.0008), hiss(2000, 10000, 0.012, 0.8, { attack: 0.0015 })] },
    castanet_lo: { layers: [skin(1750, 1720, 0.004, 0.04, 0.6, [[1.52, 0.5, 0.03]], 0.0008), hiss(1500, 8000, 0.014, 0.7, { attack: 0.0015 })] },
    castanet_roll: { layers: [skin(2400, 2350, 0.004, 0.03, 0.45, [[1.47, 0.5, 0.02]], 0.0008), hiss(2000, 10000, 0.012, 0.8, { attack: 0.0015, taps: 4 })] },
  },
  // 塞维利亚纳一类的 6/8：滚 · 嗒 嗒 · 嗒（按 4/4 的格子示范，每格一个八分音符）
  demo: { key: "C major", qpm: 112, bars: 3, drum: [{ steps: "R.cC.cR.R.cC.cR.R.cC.c.C", hits: { R: ["castanet_roll", 0.6], c: ["castanet", 0.45], C: ["castanet_lo", 0.65] } }] },
};
