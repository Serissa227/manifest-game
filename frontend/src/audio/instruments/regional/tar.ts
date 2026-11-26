// 塔尔（波斯的长颈鲁特琴）：桑木挖出的“双心形”琴身，上面蒙一张薄羊皮当面板，三组钢弦（每组两根），铜拨片拨——
// 皮面让声音又亮又“嘣”（1–3 kHz 的共振很强），比乌德琴的木面板脆、余音短；长音是拨片极快地来回轮拨（riz）。
// 句中常从下面推上去（!bend!）、勾弦的倚音（{…}）。
import type { RegionalDef } from "./types";

export const TAR: RegionalDef = {
  key: "tar",
  region: "persia",
  name: { zh: "塔尔琴", en: "Tar" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 1.35,
      tilt: 0.35,
      bright: 0.88,
      pick: 0.09,
      damp: 0.1,
      course: 3,
      thump: 0.16,
      skin: [360, 0.05, 0.1],
      onset: 0.002,
      body: [[210, 1.2, 3], [950, 1.5, 4], [2300, 1.4, 5], [4600, 1.2, -3]],
      lp: 9000,
      max: 2.4,
    },
    level: 1.04,
    tremolo: 0.42,
    tremRate: 13,
  },
  // 查哈尔加：勾弦、推上去、轮拨的长音
  demo: { key: "C chahargah", qpm: 96, bars: 4, abc: "G,2 C D E2 {F}E D | !bend!E2 F G !trem!A4 | B A G F E2 {F}E D | E D C B, !trem!C4" },
};
