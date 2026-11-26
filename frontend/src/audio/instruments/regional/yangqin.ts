// 扬琴（明代从海路传来的击弦琴）：竹槌敲在一组组金属弦上，起音“叮”、余音长而混，长音用快速的轮竹（tremolo）。
import type { RegionalDef } from "./types";

export const YANGQIN: RegionalDef = {
  key: "yangqin",
  region: "ming",
  name: { zh: "扬琴", en: "Yangqin" },
  instrument: {
    kind: "pluck",
    spec: { t60: 2.6, tilt: 0.45, bright: 0.85, pick: 0.06, damp: 0.09, course: 5, thump: 0.18, body: [[300, 1.2, 2], [1200, 1.3, 2], [3500, 1.2, 3]], lp: 11000, max: 3.5 },
    level: 0.88,
    tremolo: 0.9,
    tremRate: 14,
  },
  demo: { key: "D major", qpm: 100, bars: 3, abc: "D F A d f a f d | A F D F A d2 A | d8" },
};
