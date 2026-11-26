// 桑图尔（印度北部与波斯的击弦琴）：很轻的胡桃木槌敲一组组钢弦，“叮叮”的一串，余音混在一起像水面；长音是快速的轮奏。
import type { RegionalDef } from "./types";

export const SANTOOR: RegionalDef = {
  key: "santoor",
  region: "india",
  name: { zh: "桑图尔", en: "Santoor" },
  instrument: {
    kind: "pluck",
    spec: { t60: 3.0, tilt: 0.45, bright: 0.9, pick: 0.05, damp: 0.07, course: 6, thump: 0.15, body: [[350, 1.2, 2], [1500, 1.3, 2], [4000, 1.2, 3]], lp: 12000, max: 3.5 },
    level: 1.0,
    tremolo: 0.9,
    tremRate: 13,
  },
  demo: { key: "D mixolydian", qpm: 100, bars: 3, abc: "D F A d f a f d | c A F A c d2 A | d8" },
};
