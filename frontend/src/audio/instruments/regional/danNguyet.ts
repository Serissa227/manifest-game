// 月琴（đàn nguyệt，大越）：圆圆的琴身、两根弦、很高的品，拨片弹，声音脆、亮、短；
// 品高，所以手指一压就能把音推上去（!bend!）。在丝竹（nhạc tài tử）里给节奏、和筝与独弦琴一问一答。
import type { RegionalDef } from "./types";

export const DAN_NGUYET: RegionalDef = {
  key: "dan_nguyet",
  region: "vietnam",
  name: { zh: "月琴（越南）", en: "Đàn nguyệt" },
  instrument: {
    kind: "pluck",
    spec: { t60: 1.3, tilt: 0.45, bright: 0.85, pick: 0.1, damp: 0.14, thump: 0.11, body: [[340, 1.4, 4], [1150, 1.3, 2], [2900, 1.1, 2]], lp: 9500, max: 2.2 },
    level: 1.11,
  },
  demo: { key: "C major", qpm: 96, bars: 3, abc: "c c g c f c g c | d d a d c2 G2 | c G F D C2 z2" },
};
