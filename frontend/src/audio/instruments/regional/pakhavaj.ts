// 帕卡瓦吉（北印度的双面桶鼓，德鲁帕德与宫廷的鼓）：比塔布拉大、低、庄重。右面中间有黑的“墨”（syahi），分音成倍数——调在萨（C3）上，
// 二到五倍音的“铛”深而宽；左面每次演奏前抹一团湿麦面，低沉圆满的“咚”（不太推音，与塔布拉的左手鼓不同）。
// 鼓点：Ta（右面边上）、Din（右面中间，长鸣）、Tit（右面闷击）、Ka（左面闷拍）、Ge（左面空击的“咚”）；Dha = Ta + Ge（左右手分两个声部写）。
// 乔塔拉（Chautal，十二拍：2 + 2 + 2 + 2 + 2 + 2）：Dha Dha | Din Ta | Kit Dha | Din Ta | Tita Kata | Gadi Gana。
import { hiss, hz, skin } from "./shape";
import type { RegionalDef } from "./types";

/** 右面的萨（C3）。 */
const SA = hz(48);

export const PAKHAVAJ: RegionalDef = {
  region: "india",
  name: { zh: "帕卡瓦吉", en: "Pakhavaj" },
  drums: {
    pakh_ta: { layers: [skin(SA, SA, 0.01, 0.35, 0.35), skin(SA * 2, SA * 2, 0.01, 0.75, 1, [[1.5, 0.6, 0.5], [2, 0.35, 0.4], [2.5, 0.2, 0.3]]), hiss(1500, 6000, 0.012, 0.45)], vary: 0.008 },
    pakh_din: { layers: [skin(SA * 1.02, SA, 0.015, 1.1, 1, [[2, 0.35, 0.6], [3, 0.18, 0.45], [4, 0.1, 0.3]]), hiss(600, 2500, 0.012, 0.2)], vary: 0.008 },
    pakh_tit: { layers: [skin(SA * 2, SA * 2, 0.01, 0.06, 0.55), hiss(700, 3500, 0.02, 0.6)], vary: 0.01 },
    pakh_ka: { layers: [skin(120, 100, 0.01, 0.06, 0.6), hiss(250, 2500, 0.03, 0.8)] },
    pakh_ge: { layers: [skin(80, 66, 0.04, 0.9, 1, [[1.62, 0.2, 0.3], [2.3, 0.1, 0.2]]), hiss(80, 700, 0.05, 0.35)] },
  },
  // 乔塔拉一轮（十二拍，每拍两格）：右手与左手
  demo: {
    key: "C minor",
    qpm: 84,
    bars: 3,
    drum: [
      { steps: "n.n.d.n..tn.d.n.tn.n.d.n", hits: { n: ["pakh_ta", 0.85], d: ["pakh_din", 0.85], t: ["pakh_tit", 0.65] } },
      { steps: "G.G.....k.G.......k.G.G.", hits: { G: ["pakh_ge", 0.9], k: ["pakh_ka", 0.65] } },
    ],
  },
};
