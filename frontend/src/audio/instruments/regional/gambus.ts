// 甘布斯（gambus，马来世界的短颈琉特）：随哈德拉毛的阿拉伯商人从也门的“甘布斯”（qanbus）传到马六甲、柔佛、亚齐与文莱，
// 整块木头挖出的窄琴身，面板的下半蒙着羊皮——所以比乌德琴“扁”、带一点鼻音与皮的闷响，余音短；羽管的拨片，长音用轮拨。
// 它领着扎宾舞（zapin）：甘布斯、几只马尔瓦斯小鼓（marwas，用阿拉伯一区的 mirwas 鼓点）、框鼓。
// 无品的滑音写 !slide!、!bend!（第九批 A01：马六甲海峡的航海曲）。
import type { RegionalDef } from "./types";

export const GAMBUS: RegionalDef = {
  key: "gambus",
  region: "nusantara",
  name: { zh: "甘布斯", en: "Gambus" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 1.15,
      tilt: 0.42,
      bright: 0.72,
      pick: 0.12,
      damp: 0.24,
      course: 3,
      thump: 0.12,
      skin: [260, 0.07, 0.3],
      body: [[200, 1.4, 4], [560, 1.3, 3], [1500, 1.3, 2], [3000, 1, -3]],
      lp: 6800,
      max: 2.2,
    },
    level: 1.55,
    tremolo: 0.9,
    tremRate: 13,
  },
  // D 小调带升四级的经过音：扎宾的一句——上行、滑到五级、轮拨的长音
  demo: { key: "D minor", qpm: 100, bars: 4, abc: "D2 F G A2 d2 | c B A G !slide!A4 | F G A B A G F E | !trem!D8" },
};
