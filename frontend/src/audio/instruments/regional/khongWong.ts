// 孔旺艾（khong wong yai，暹罗的大围锣）：十六只带乳头的小锣排成一圈，乐手坐在圈里，皮裹的槌敲；
// 它奏乐曲的“骨干”（luk tok），常常两手隔八度或隔四五度一起敲，余音长、带一点慢慢的“翁”。
import type { RegionalDef } from "./types";

export const KHONG_WONG: RegionalDef = {
  key: "khong_wong",
  region: "siam",
  name: { zh: "孔旺艾（大围锣）", en: "Khong wong yai" },
  instrument: {
    kind: "mallet",
    // 乳锣：基音最强，第二分音在 2.3 倍附近（与博南的 2.0 / 2.76 不同），拍音慢
    spec: { partials: [[1, 1, 2.4], [2.32, 0.28, 0.9], [3.1, 0.16, 0.55], [4.62, 0.1, 0.32], [6.05, 0.05, 0.2]], attack: 0.002, strike: [0.22, 0.005, 3200], beat: 1.6, tilt: 0.3, max: 3 },
    level: 0.6,
    release: 0.9,
  },
  // 骨干：隔八度一起敲，落在句尾
  demo: { key: "G mixolydian", qpm: 90, bars: 3, abc: "[G,G]2 [A,A]2 [D,D]2 [_/E,_/E]2 | [D,D]4 [G,G]4 | [_/B,_/B]2 [A,A]2 [G,G]4" },
};
