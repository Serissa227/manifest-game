// 乌德琴（奥斯曼与阿拉伯，新的一版）：无品、复弦，鹰羽的拨片在琴桥前拨，深的梨形琴身（110 Hz 一带的“腹”与 290 Hz 的箱体），
// 比旧的 oud 多一点拨片的颗粒与低音的胸腔，余音略长；无品的滑音写 !slide! !bend!，揉弦写 !vib!，长音按拨片的轮拨（tremolo）。
// 旧的 oud 不动（别的曲子在用），两版都留着，听了再定。
import type { RegionalDef } from "./types";

export const UD: RegionalDef = {
  key: "ud",
  region: "ottoman",
  name: { zh: "乌德琴（新）", en: "Ud" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 1.6,
      tilt: 0.4,
      bright: 0.62,
      pick: 0.14,
      damp: 0.26,
      course: 3,
      thump: 0.1,
      body: [[110, 1.5, 5], [290, 1.3, 3], [650, 1.4, -2], [1600, 1.2, 2], [3200, 1, -5]],
      lp: 6000,
      max: 2.6,
    },
    level: 0.91,
    tremolo: 0.95,
    tremRate: 14,
  },
  // A 希贾兹：增二度、滑上去、轮拨的长音
  demo: { key: "A hijaz", qpm: 92, bars: 4, abc: "A2 B c d2 c B | A G A B !slide!c4 | e d c B !vib!A2 G2 | A8" },
};
