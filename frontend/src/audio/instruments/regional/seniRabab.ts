// 德鲁帕德的拉巴卜（塞尼拉巴卜，北印度宫廷）：深的木琴身、蒙皮的琴面、羊肠弦，用木拨子拨——粗、暗、带一声皮面的“嘭”，余音不长。
// 传说是坦森一家（宫廷乐师）的乐器，与鲁德拉维纳琴、帕卡瓦吉一起奏德鲁帕德；拉格的滑音写 !bend!，句尾落下写 !fall!。
// 键 seni_rabab：原来叫 rabab（文件 rabab.ts），与马格里布的安达卢斯拉巴卜（rabab.ts，键 rabab）同名，整合时改成这个名字。
import type { RegionalDef } from "./types";

export const SENI_RABAB: RegionalDef = {
  key: "seni_rabab",
  region: "india",
  name: { zh: "拉巴卜（德鲁帕德）", en: "Seni Rabab" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 1.8,
      tilt: 0.45,
      bright: 0.52,
      pick: 0.16,
      damp: 0.28,
      thump: 0.08,
      // 木拨子打在蒙皮的琴面上
      skin: [180, 0.06, 0.22],
      // 深的木琴身（110 Hz）、皮面（240 Hz）；羊肠弦的高频往下压
      body: [[110, 1.3, 5], [240, 1.2, 3], [800, 1.4, 1], [2500, 1.2, -3]],
      lp: 5000,
      max: 3,
    },
    level: 1.24,
  },
  // 达尔巴里（萨 = C）：中音区一句，滑上去、句尾落下
  demo: { key: "C minor", qpm: 84, bars: 3, abc: "C2 D2 !bend!E2 F2 | D2 C2 B,2 !bend!C2 | G,2 A,2 B,2 !fall!C2" },
};
