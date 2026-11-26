// 琵琶（明）：手指戴着假指甲，在靠近琴码处弹，起音脆、亮，品位上的音很稳；长音是轮指——五个手指轮流弹出的一串均匀的颗粒
// （tremRate 每秒 17 下，tremPattern 是大指与四指的轻重）；推弦写 !bend!，吟揉写 !vib!。
import type { RegionalDef } from "./types";

export const PIPA: RegionalDef = {
  key: "pipa",
  region: "ming",
  name: { zh: "琵琶", en: "Pipa" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 1.6,
      tilt: 0.45,
      bright: 0.92,
      pick: 0.08,
      damp: 0.1,
      thump: 0.12,
      body: [[380, 1.4, 3], [1400, 1.2, 3], [3000, 1.1, 3]],
      lp: 10500,
      max: 2.4,
    },
    level: 1.0,
    tremolo: 0.45,
    tremRate: 17,
    tremPattern: [0.82, 0.66, 0.72, 0.68, 0.76],
  },
  // 弹挑、轮指、推弦
  demo: { key: "D major", qpm: 96, bars: 4, abc: "A2 d2 e4 | d B A F E2 D2 | !bend!F2 E D B,2 A,2 | D8" },
};
