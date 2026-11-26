// 乌利乌利（夏威夷的 ʻulīʻulī）：小葫芦里装着美人蕉的种子，顶上插一簇彩色羽毛，跳呼拉时手里摇——
// 一摇是“沙”的一下（颗粒比玛雅的葫芦沙铃细、亮），转腕一甩是带着羽毛摩擦的长“唰——”（uliuli_swish）。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const ULIULI: RegionalDef = {
  region: "pacific",
  name: { zh: "乌利乌利羽毛沙铃", en: "ʻUlīʻulī (feathered gourd rattle)" },
  drums: {
    uliuli: { layers: [hiss(2200, 9500, 0.06, 1, { attack: 0.008, taps: 4 }), skin(380, 360, 0.01, 0.05, 0.12)] },
    uliuli_swish: { layers: [hiss(1800, 8000, 0.16, 0.8, { attack: 0.04, taps: 6 })] },
  },
  demo: { key: "C major", qpm: 96, bars: 3, drum: [{ steps: "S.s.S.s.S.ssS.s.S...W...", hits: { S: ["uliuli", 0.85], s: ["uliuli", 0.5], W: ["uliuli_swish", 0.8] } }] },
};
