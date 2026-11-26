// 班多拉琴（英格兰的 bandora / pandora：1560 年代伦敦发明的低音金属弦琴，伊丽莎白时代“混合乐队”（broken consort）的低音）：
// 扇贝形的琴身、钢与黄铜的复弦，拨片或手指拨；低音厚而亮、余音长，复弦拍出一点“哗”；弹低音线，也扫和弦。
import type { RegionalDef } from "./types";

export const BANDORA: RegionalDef = {
  key: "bandora",
  region: "north_europe",
  name: { zh: "班多拉琴（英格兰）", en: "Bandora" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 2.9,
      tilt: 0.4,
      bright: 0.72,
      pick: 0.17,
      damp: 0.12,
      course: 3,
      thump: 0.06,
      body: [[110, 1.4, 4], [260, 1.3, 3], [1800, 1, 2]],
      lp: 7000,
      max: 4,
    },
    level: 0.79,
  },
  // D 调的低音线与扫弦
  demo: { key: "D mixolydian", qpm: 100, bars: 3, abc: "D,4 A,,4 | C,4 G,,4 | [D,A,DF]4 [D,A,D]4" },
};
