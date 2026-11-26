// 琵琶（日本的萨摩琵琶、筑前琵琶）：很大的拨子，四五根粗丝弦，品很高（按下去音高往上推，写 !bend!），
// 琴颈上的 sawari 让每一拨都带“嗡”；拨子扫过几根弦再打在琴面上，像一声叹息，讲故事的乐器。
import type { RegionalDef } from "./types";

export const BIWA: RegionalDef = {
  key: "biwa",
  region: "japan",
  name: { zh: "琵琶（日本）", en: "Biwa" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 1.9,
      tilt: 0.4,
      bright: 0.8,
      pick: 0.13,
      damp: 0.16,
      thump: 0.2,
      buzz: { at: 0.5, level: 5 },
      skin: [160, 0.06, 0.3],
      body: [[140, 1.3, 4], [420, 1.3, 2], [1900, 1.2, 3]],
      lp: 8000,
      max: 3,
    },
    level: 1.22,
    release: 0.3,
  },
  // 低音的空弦、拨子的扫、推弦
  demo: { key: "E phrygian", qpm: 76, bars: 3, abc: "[E,B,]2 z2 E2 !bend!A2 | B2 A F !bend!A4 | [E,B,E]4 !slide!E,4" },
};
