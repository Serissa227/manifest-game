// 埃戈戈（贝宁宫廷的铁双铃，egogo；约鲁巴人叫阿戈戈 agogo）：两只锻铁的铃一大一小，用木棒敲，没有铃舌；
// 十六世纪贝宁的铜牌上就铸着宫廷乐师一手提着它、一手拿棒敲的样子。鼓队靠它管拍子：
// 这里用 12/8 的五下型（x · x · x · · x · x · ·，几内亚湾一带叫“富梅富梅”），与刚果恩贡吉的七下标准型分开。
// 比恩贡吉大、低、余音长一点；铁铃的分音不成倍数（1、1.6、2.35、3.1……），一敲是“当”而不是“叮”。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

/** 一只铃：基音 f 赫兹、余音 decay 秒。 */
function bell(f: number, decay: number) {
  return { layers: [skin(f, f, 0.01, decay, 1, [[1.6, 0.5, decay * 0.65], [2.35, 0.3, decay * 0.45], [3.1, 0.14, decay * 0.3]]), hiss(1800, 8000, 0.006, 0.3)], vary: 0.008 };
}

export const EGOGO: RegionalDef = {
  region: "guinea",
  name: { zh: "埃戈戈（贝宁的铁双铃）", en: "Egogo (Benin double bell)" },
  drums: {
    egogo_hi: bell(760, 0.5),
    egogo_lo: bell(540, 0.62),
  },
  // 12/8 的五下型：低铃起头，高铃接着
  demo: { key: "C major", qpm: 120, bars: 3, drum: [{ steps: "L.h.h..L.h..L.h.h..L.h..", hits: { h: ["egogo_hi", 0.75], L: ["egogo_lo", 0.85] } }] },
};
