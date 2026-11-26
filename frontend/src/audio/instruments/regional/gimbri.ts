// 金布里（马格里布，格纳瓦的低音鲁特琴，也写 guembri / sintir）：一根圆木棍穿过挖空的长木箱，箱面蒙骆驼皮，三根羊肠弦——
// 低、厚、带鼓的味道：拇指拨弦的同时常常拍在皮面上（gimbri_slap）；琴头挂着一块穿了铁环的铁片（sersera），每拨一下都“沙沙”地抖。
// 格纳瓦的夜祭（lila）里，它在小五声音阶上反复弹一句固定的低音（像念咒），铁响板（卡拉卡布）与拍手跟着三连音的律动。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const GIMBRI: RegionalDef = {
  key: "gimbri",
  region: "maghreb",
  name: { zh: "金布里琴", en: "Gimbri" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 1.05,
      tilt: 0.22,
      bright: 0.5,
      pick: 0.22,
      damp: 0.3,
      thump: 0.2,
      skin: [96, 0.09, 0.4],
      rattle: { level: 0.24, lo: 2500, hi: 7500, gate: 0.025 },
      body: [[86, 1.2, 6], [190, 1.3, 4], [700, 1.2, -3], [1800, 1.2, 2]],
      lp: 5000,
      max: 2,
    },
    level: 1.52,
  },
  drums: {
    gimbri_slap: { layers: [skin(132, 92, 0.015, 0.12, 1, undefined, 0.0005), hiss(300, 2500, 0.03, 0.45), hiss(2500, 7500, 0.12, 0.28, { taps: 3, attack: 0.002 })] },
  },
  // D 小五声的固定低音（D F G A C）：一拨一拍，句尾滑下来；下面拍皮
  demo: {
    key: "D dorian",
    qpm: 100,
    bars: 4,
    abc: "D,,2 D,, F,, G,,2 A,, G,, | F,, D,, F,, D,, C,,2 D,,2 | D,,2 D,, F,, G,,2 A,, C, | A,, G,, F,, G,, !fall!D,,4",
    drum: [{ steps: "..s...s...s..s.s..s...s...s..s..", hits: { s: ["gimbri_slap", 0.6] } }],
  },
};
