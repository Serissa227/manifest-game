// 西特（siter / celempung，爪哇的弹拨齐特琴）：每个音两根调成同音的铜丝弦，拇指甲拨，一拨就用别的手指按掉上一个音；
// 亮、闪、短，在宫廷的软合奏里奏快的分解句子。
import type { RegionalDef } from "./types";

export const SITER: RegionalDef = {
  key: "siter",
  region: "nusantara",
  name: { zh: "西特（齐特琴）", en: "Siter" },
  instrument: {
    kind: "pluck",
    spec: { t60: 2.2, tilt: 0.5, bright: 0.85, pick: 0.1, damp: 0.1, course: 3, thump: 0.06, body: [[320, 1.2, 3], [1300, 1.3, 2], [3200, 1.1, 3]], lp: 10500, max: 3 },
    level: 0.91,
    // 手指按掉上一个音
    release: 0.12,
  },
  demo: { key: "F major", qpm: 90, bars: 3, abc: "F c A c G d c d | A f d f c A G F | [F,F]4 z4" },
};
