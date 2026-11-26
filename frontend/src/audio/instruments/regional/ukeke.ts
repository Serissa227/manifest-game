// 乌克克（夏威夷的 ʻukeke，口弓）：一根弯木上张两三根弦，一头含在嘴边，手指拨弦，嘴腔当共鸣箱——
// 张嘴、收嘴选出弦的某一个泛音，于是在低低的弦音上面浮着一个“唱”出来的高音；很轻，情人之间的私语。
// 做法：加法合成（与击奏同一套），分音是一根弦的谐波（基音在写的音下面两个八度），嘴腔把第四谐波（写的音）推得最响，
// 旁边的第三、第五谐波也带起来一点。
import type { RegionalDef } from "./types";

export const UKEKE: RegionalDef = {
  key: "ukeke",
  region: "pacific",
  name: { zh: "乌克克口弓", en: "ʻUkeke (mouth bow)" },
  instrument: {
    kind: "mallet",
    spec: {
      partials: [
        [0.25, 0.42, 1.8],
        [0.5, 0.3, 1.4],
        [0.75, 0.32, 1.2],
        [1, 1, 1.3],
        [1.25, 0.3, 0.8],
        [1.5, 0.16, 0.6],
        [1.75, 0.08, 0.45],
        [2, 0.06, 0.35],
        [2.5, 0.03, 0.25],
      ],
      attack: 0.002,
      strike: [0.12, 0.003, 3500],
      tilt: 0.25,
      max: 2.5,
    },
    level: 1.0,
  },
  // 写的音是嘴腔选出来的泛音（弦在下面两个八度）
  demo: { key: "D mixolydian", qpm: 84, bars: 3, abc: "d2 d A d2 A2 | d2 e d A2 d2 | g2 e d d4" },
};
