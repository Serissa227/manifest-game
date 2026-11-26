// 贝格纳琴（埃塞俄比亚）：十根羊肠弦的大里拉琴，琴码与弦之间夹着 U 形的小皮片，弦一振就擦着皮片“嗡——”地响；
// 音低、余音长，嗡声一直跟着——只用来伴唱祈祷与冥想的歌（梅兹穆尔），慢、深、像在殿里。手指拨，不用拨片。
import type { RegionalDef } from "./types";

export const BEGENA: RegionalDef = {
  key: "begena",
  region: "ethiopia",
  name: { zh: "贝格纳琴（大里拉琴）", en: "Begena" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 4.0,
      tilt: 0.45,
      bright: 0.55,
      pick: 0.28,
      damp: 0.22,
      thump: 0.04,
      buzz: { at: 0.35, level: 11, hp: 500 },
      body: [[110, 1.1, 5], [350, 1.2, 3], [1700, 1, 2]],
      lp: 7000,
      max: 5,
    },
    level: 0.87,
  },
  // 安巴塞尔（E F A B C）的低音区：慢慢地拨，嗡声留着
  demo: { key: "E phrygian", qpm: 66, bars: 3, abc: "E,4 F,2 A,2 | B,4 A,2 F,2 | C2 B,2 A,2 E,2" },
};
