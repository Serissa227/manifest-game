// 三板（さんば，琉球）：三块硬木片夹在一只手的指间，一捏就“咔嚓咔嚓”地连着响——唱跳的“カチャーシー”里打碎拍子，
// 一下是“咔”（几片木头先后碰上），快速地抖是一串“嚓啦啦”。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const SANBA: RegionalDef = {
  region: "ryukyu",
  name: { zh: "三板（琉球）", en: "Sanba" },
  drums: {
    // 起音留一毫秒多（很硬的木头在安静处一碰，头几个采样跳得太猛会像“咔嗒”的断点）
    sanba: { layers: [skin(2600, 2550, 0.005, 0.03, 0.5, [[1.4, 0.4, 0.02]], 0.001), hiss(2000, 9000, 0.02, 0.9, { attack: 0.0015, taps: 3 })] },
    sanba_roll: { layers: [skin(2600, 2550, 0.005, 0.03, 0.4, undefined, 0.001), hiss(2000, 9000, 0.03, 0.9, { attack: 0.0015, taps: 7 })] },
  },
  // 咔 · 咔咔 咔 · | 嚓啦啦 · 咔 ·
  demo: { key: "C major", qpm: 112, bars: 3, drum: [{ steps: "x.xxx.R.x.x.", hits: { x: ["sanba", 0.75], R: ["sanba_roll", 0.8] } }] },
};
