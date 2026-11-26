// 坦布拉（印度的持续音琴）：手指轻拨四根长弦，jawari 让嗡声在很长的余音里慢慢展开（门限低，嗡到很轻才停）；
// 一轮“五 — 一 — 一 — 低一”接着一轮，从不停下——所有北印度音乐底下的那层光。
import type { RegionalDef } from "./types";

export const TANPURA: RegionalDef = {
  key: "tanpura",
  region: "india",
  name: { zh: "坦布拉", en: "Tanpura" },
  instrument: {
    kind: "pluck",
    spec: { t60: 9, tilt: 0.2, bright: 0.45, pick: 0.24, damp: 0.17, thump: 0.02, buzz: { at: 0.3, level: 7, hp: 1500 }, body: [[120, 1.2, 3], [400, 1.2, 2]], lp: 7000, max: 7.5 },
    level: 0.79,
    release: 1.5,
  },
  demo: { key: "D major", qpm: 60, bars: 3, abc: "A,4 D4 | D4 D,4 | A,4 D4" },
};
