// 赛塔尔（波斯）：很轻的小长颈琴，木面板，四根细弦，只用食指的指甲上下拨——轻、柔、细，像一个人在屋里低声自语；
// 第四根弦（开放的持续音）常常随手带上（曲谱里在句中点一下主音）。比塔尔琴暗、起音软、余音更长一点。
import type { RegionalDef } from "./types";

export const SETAR: RegionalDef = {
  key: "setar",
  region: "persia",
  name: { zh: "赛塔尔琴", en: "Setar" },
  instrument: {
    kind: "pluck",
    spec: { t60: 2.3, tilt: 0.45, bright: 0.58, pick: 0.17, damp: 0.17, thump: 0.035, body: [[260, 1.3, 3], [720, 1.4, 2], [2000, 1.2, -1]], lp: 7000, max: 3.2 },
    level: 0.94,
    tremolo: 0.6,
    tremRate: 11,
  },
  // 查哈尔加：轻轻地拨，句中点一下开放的主音弦
  demo: { key: "C chahargah", qpm: 80, bars: 3, abc: "C2 D E F2 E D | C G, C D !vib!E4 | F E D C !fall!C4" },
};
