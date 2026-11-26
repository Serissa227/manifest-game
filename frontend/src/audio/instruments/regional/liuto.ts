// 文艺复兴的鲁特琴（liuto，意大利；威尼斯 1508 年就印了达尔扎的鲁特琴帕凡舞）：圆背的梨形琴身、羊肠复弦，
// 低音的几组是“八度弦”（一根原音、一根高八度：octave），拇指与食指交替在音孔附近拨，音头甜、余音短、暗一点（羊肠 + 圆背）。
// 弹法：帕凡舞与加利亚德舞的旋律、分解和弦（写 arp 伴奏型）、弗罗托拉的和弦伴唱。
// 与原有的 lute（经典世界在用）不同：八度弦让低音带一层亮光，拨弦位置更靠中间（更甜），余音更短。
import type { RegionalDef } from "./types";

export const LIUTO: RegionalDef = {
  key: "liuto",
  region: "iberia_italy",
  name: { zh: "文艺复兴鲁特琴", en: "Renaissance lute" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 1.7,
      tilt: 0.5,
      bright: 0.58,
      pick: 0.22,
      damp: 0.26,
      course: 2,
      octave: 0.35,
      thump: 0.05,
      onset: 0.002,
      body: [[125, 1.5, 3], [260, 1.3, 4], [620, 1.3, 1.5], [1500, 1.2, 1], [3300, 1, -5]],
      lp: 6200,
      max: 3,
    },
    level: 0.96,
  },
  // G 多利亚：帕凡舞的一句（二分、四分、四分），再一串分解和弦
  demo: {
    key: "G dorian",
    qpm: 88,
    bars: 4,
    abc: "G4 A2 B2 | c4 B2 A2 | G, D G B d B G D | [G,DGB]8",
  },
};
