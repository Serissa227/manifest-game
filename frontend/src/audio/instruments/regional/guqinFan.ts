// 古琴的泛音（guqin_fan）：左手轻轻点在徽位上、右手一弹，弦只剩这个节点的谐波——清、亮、几乎是正弦，像远处的磬，余音长。
// 琴曲常以一段泛音开头（“泛起”），也以泛音收尾。做法：加法合成（击奏一类），基频之外只有一点点二、三倍频，
// 起音 4 毫秒（指肉碰弦，不是“叮”的一下），两个相差 0.3 Hz 的分音让长音里有极慢的起伏。
import type { RegionalDef } from "./types";

export const GUQIN_FAN: RegionalDef = {
  key: "guqin_fan",
  region: "ming",
  name: { zh: "古琴·泛音", en: "Guqin harmonics" },
  instrument: {
    kind: "mallet",
    spec: {
      partials: [[1, 1, 3.4], [2, 0.05, 1.4], [3, 0.02, 0.7]],
      attack: 0.004,
      strike: [0.035, 0.002, 3500],
      beat: 0.3,
      tilt: 0.3,
      max: 5,
    },
    level: 0.28,
    release: 1.5,
  },
  // 泛音的一句（徽位上的五声）
  demo: { key: "F major", qpm: 60, bars: 3, abc: "c2 d2 f2 g2 | a4 g2 f2 | d4 c4" },
};
