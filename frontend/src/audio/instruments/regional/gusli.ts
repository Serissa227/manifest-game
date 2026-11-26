// 古斯里琴（罗斯的翼形 gusli：诺夫哥罗德的考古里就有，说唱人 skomorokh 与“壮士歌”的伴奏）：平放在膝上，
// 右手一扫所有的弦、左手手指按住不要的几根——所以是一串一串的扫弦和弦，偶尔拨单音的旋律；
// 金属弦（早期是羊肠）明亮、余音长，没被按住的空弦被带着一起响（共鸣弦，调在 G 调的 D、G、A、d、g 上），整片“叮——”地亮着。
import type { RegionalDef } from "./types";

export const GUSLI: RegionalDef = {
  key: "gusli",
  region: "north_europe",
  name: { zh: "古斯里琴", en: "Gusli" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 3.4,
      tilt: 0.45,
      bright: 0.86,
      pick: 0.14,
      damp: 0.09,
      thump: 0.05,
      body: [[300, 1.2, 3], [900, 1.2, 2], [2600, 1, 2.5]],
      sympathetic: { notes: [50, 55, 57, 62, 67], level: 0.008, t60: 2.6 },
      lp: 10000,
      max: 4.5,
      onset: 0.002,
    },
    level: 0.81,
  },
  // A 小调：扫弦的和弦与单音的旋律
  demo: { key: "A minor", qpm: 90, bars: 3, abc: "[A,EAc]2 [A,EAc]2 [G,DGB]2 [A,EAc]2 | e d c B A2 E2 | [CEGc]2 [G,DGB]2 [A,EA]4" },
};
