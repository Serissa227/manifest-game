// 维金纳琴（安特卫普鲁克斯家族的 muselar：1579 年起安特卫普造的长方形小键盘乐器，佛兰德斯家家户户的客厅里都有）：
// muselar 的拨片拨在弦的正中间，偶次谐波几乎被抵消，所以比羽管键琴（harpsichord，拨在弦端，亮而带鼻音）圆、甜、像长笛；
// 低音区“嗡嗡”的，起音有拨片与跳杆的一下轻响，余音中等长。
import type { RegionalDef } from "./types";

export const VIRGINAL: RegionalDef = {
  key: "virginal",
  region: "north_europe",
  name: { zh: "维金纳琴（安特卫普）", en: "Virginal (Flemish muselar)" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 2.6,
      tilt: 0.55,
      bright: 0.72,
      pick: 0.5,
      damp: 0.1,
      thump: 0.07,
      body: [[180, 1, 2.5], [900, 1.2, 2], [3000, 1, 1.5]],
      lp: 9000,
      max: 3.5,
    },
    level: 0.83,
  },
  // F 大调：右手的旋律、左手的分解和弦
  demo: { key: "F major", qpm: 100, bars: 3, abc: "c4 A2 A2 | G2 E2 G2 c2 | [F,A,CF]8" },
};
