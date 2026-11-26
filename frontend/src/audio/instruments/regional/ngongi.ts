// 恩贡吉（刚果的双铃，ngongi）：两只锻铁的铃用一根弯把连着，木棒敲，高的一只“叮”、低的一只“当”——
// 刚果的王权与祭礼的器物，也是鼓乐里管拍子的铃：12/8 的“标准型”（x · x · x x · x · x · x）就靠它。
// 铁铃的分音不成倍数（1、1.47、2.09、2.76……），一敲就是一个亮而短的“叮”。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

/** 一只铃：基音 f 赫兹、余音 decay 秒。 */
function bell(f: number, decay: number) {
  return { layers: [skin(f, f, 0.01, decay, 1, [[1.47, 0.55, decay * 0.7], [2.09, 0.3, decay * 0.45], [2.76, 0.18, decay * 0.3]]), hiss(2000, 9000, 0.006, 0.35)], vary: 0.008 };
}

export const NGONGI: RegionalDef = {
  region: "kongo",
  name: { zh: "恩贡吉（双铃）", en: "Ngongi (double bell)" },
  drums: {
    ngongi_hi: bell(1180, 0.5),
    ngongi_lo: bell(840, 0.6),
  },
  // 12/8 的标准型（高铃），每圈的头上敲一下低铃
  demo: { key: "C major", qpm: 132, bars: 3, drum: [{ steps: "L.h.hh.h.h.hL.h.hh.h.h.h", hits: { h: ["ngongi_hi", 0.75], L: ["ngongi_lo", 0.85] } }] },
};
