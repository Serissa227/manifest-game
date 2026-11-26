// 库林唐（kulintang，菲律宾南部马京达瑙、马拉瑙与苏禄的排锣）：八只由大到小的乳锣横排在木架上，两根软木槌敲，
// “当”的一声亮而圆、带一点快的颤；锣乐队里只有它奏旋律——在鼓与大锣的节奏型（rhythmic mode）上即兴地绕、反复、变化。
// 调律每套都不一样，曲谱按十二平均律近似。
import type { RegionalDef } from "./types";

export const KULINTANG: RegionalDef = {
  key: "kulintang",
  region: "philippines",
  name: { zh: "库林唐（排锣）", en: "Kulintang" },
  instrument: {
    kind: "mallet",
    // 小乳锣：第二分音在 2.62 倍附近（博南是 2.0 / 2.76），木槌比博南的布槌硬、起音亮，拍音快
    spec: { partials: [[1, 1, 1.5], [2.62, 0.3, 0.5], [3.61, 0.14, 0.3], [5.15, 0.07, 0.18]], attack: 0.0015, strike: [0.3, 0.003, 5200], beat: 4.2, tilt: 0.3, max: 2.3 },
    level: 0.75,
    release: 0.5,
  },
  // 八只锣（D E G A B d e g）上的一段：快的十六分音符绕着骨干音
  demo: { key: "G major", qpm: 120, bars: 4, abc: "d/2B/2d/2e/2 d/2B/2A/2G/2 A2 B2 | d/2e/2d/2B/2 A/2G/2A/2B/2 G2 E2 | G/2A/2B/2d/2 e2 g/2e/2d/2B/2 d2 | B/2A/2G/2E/2 D2 G4" },
};
