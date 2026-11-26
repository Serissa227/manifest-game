// 达夫（波斯与库尔德的大框鼓）：直径半米的木框蒙羊皮，框里一圈挂满小铁环——
// 鼓心的“咚”很低（60–80 Hz），每一下都带着铁环“哗”的一大片，余音长；鼓边的“嗒”亮，铁环同样跟着响；
// 整面一抖只让铁环响（ring），苏菲的仪式与节庆里像潮水一样起伏。比本迪尔（羊肠响弦的“嗞”）与里克鼓（黄铜小钹的“铮”）都更“沙”、更散。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const DAF: RegionalDef = {
  region: "persia",
  name: { zh: "达夫框鼓", en: "Daf" },
  drums: {
    daf_dum: { layers: [skin(80, 56, 0.035, 0.62, 1, [[1.6, 0.2, 0.2]], 0.0006), hiss(2200, 9000, 0.34, 0.3, { taps: 9, attack: 0.002 })] },
    daf_tak: { layers: [skin(340, 320, 0.01, 0.07, 0.35, undefined, 0.0004), hiss(2200, 9500, 0.3, 0.55, { taps: 9, attack: 0.002 }), hiss(1500, 6000, 0.012, 0.35, { attack: 0.0006 })] },
    daf_ring: { layers: [hiss(2000, 9000, 0.42, 1, { taps: 11, attack: 0.012 })] },
  },
  // 咚 · · 嗒 · 嗒，铁环在空处一抖
  demo: { key: "C major", qpm: 88, bars: 4, drum: [{ steps: "D..t.tr.D..t.t..D..t.tr.D.tt.rr.", hits: { D: ["daf_dum", 0.9], t: ["daf_tak", 0.7], r: ["daf_ring", 0.45] } }] },
};
