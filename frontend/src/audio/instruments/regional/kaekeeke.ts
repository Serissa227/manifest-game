// 卡埃克埃克（夏威夷的 kāʻekeʻeke，斐济叫 derua）：一端留着竹节、一端开口的粗竹筒，竖着往地上（或石头上）一顿，
// 筒里的空气“嘣”地一响——闭管，只有奇次谐波；两三根长短不同的竹筒各一个音，跳舞时一高一低地轮流顿。
import type { RegionalDef } from "./types";

export const KAEKEEKE: RegionalDef = {
  key: "kaekeeke",
  region: "pacific",
  name: { zh: "顿竹筒（卡埃克埃克）", en: "Kāʻekeʻeke (stamping tubes)" },
  instrument: {
    kind: "mallet",
    spec: { partials: [[1, 1, 0.3], [3.02, 0.2, 0.08], [5.03, 0.07, 0.04], [7.1, 0.03, 0.025]], attack: 0.004, strike: [0.6, 0.015, 700], tilt: 0.15, max: 0.9 },
    level: 1.24,
  },
  // 两根竹筒（D 与下方四度的 A）一高一低地顿
  demo: { key: "D mixolydian", qpm: 100, bars: 3, abc: "D,2 A,,2 D, D, A,,2 | D,2 A,,2 D,2 A,,2 | D, D, A,, A,, D,2 z2" },
};
