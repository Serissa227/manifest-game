// 多塔拉（孟加拉的民间弹拨乐器）：一整块木头挖成的长颈小琴，琴面蒙羊皮，几根金属弦用拨片弹——亮、带一点“铮”、皮面“嘭”地一响，余音不长；
// 孟加拉的船歌（bhatiyali）与游吟诗人的歌里，它在唱腔的空当里弹一串短句。滑上去写 !bend!，句尾落下写 !fall!。
import type { RegionalDef } from "./types";

export const DOTARA: RegionalDef = {
  key: "dotara",
  region: "india",
  name: { zh: "多塔拉", en: "Dotara" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 1.6,
      tilt: 0.4,
      bright: 0.8,
      pick: 0.08,
      damp: 0.12,
      thump: 0.08,
      // 拨片打在羊皮的琴面上
      skin: [260, 0.05, 0.18],
      // 小的木琴身（180 Hz）、皮面（600 Hz）、金属弦的亮（2.5 kHz）
      body: [[180, 1.2, 4], [600, 1.3, 2], [2500, 1.2, 3]],
      lp: 9000,
      max: 2.6,
    },
    level: 0.96,
  },
  // 梅格（雨季的拉格，萨 = E：E 升F A B D）：一串短句，滑上去、落下
  demo: { key: "E mixolydian", qpm: 96, bars: 3, abc: "E F A B d B A F | !bend!A2 B d e2 d B | A F E F !fall!E4" },
};
