// 古琴的走手音（guqin_zou）：弹过一声以后左手按着弦滑到下一个音（上、下、进、复），右手不再弹——只剩弦上还没消失的余音被推着走。
// 做法：与按音同一根“弦”，但起音淡入 70 毫秒（没有新的拨弦）、更暗（余音里的高频已经没了）；放在单独的声部里、音量比按音低，
// 跟在按音后面奏，配上 !slide!（从下面滑上来）或 !bend!（从低一个全音处推上来），听起来就是同一声余音滑到了新的音上。
import type { RegionalDef } from "./types";

export const GUQIN_ZOU: RegionalDef = {
  key: "guqin_zou",
  region: "ming",
  name: { zh: "古琴·走手音", en: "Guqin slide" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 4.2,
      tilt: 0.35,
      bright: 0.26,
      pick: 0.11,
      damp: 0.36,
      thump: 0,
      body: [[98, 1.3, 5], [210, 1.4, 3], [520, 1.3, 1], [1600, 1, -3]],
      lp: 3200,
      max: 5,
      onset: 0.07,
    },
    level: 0.6,
    release: 1.4,
  },
  // 走手：上（推上去）、下（落下来）、进复（来回）
  demo: { key: "F major", qpm: 60, bars: 3, abc: "!bend!G4 !bend!A4 | !slide!c4 !fall!A4 | !bend!G4 !fall!F4" },
};
