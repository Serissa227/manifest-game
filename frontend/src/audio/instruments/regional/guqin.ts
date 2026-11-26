// 古琴（明，文人的琴）：七根丝弦、没有品，低、温、木头味，余音长；右手在靠近岳山处弹，丝弦的高频很快就没了。
// 琴的三种声音分成三件（一件一个文件）：散音与按音（guqin，本件）、泛音（guqin_fan：轻点徽位，清亮如钟）、走手音（guqin_zou：弹过以后左手在弦上滑走，
// 不再起音，只剩滑过去的余音）。装饰：绰（从下面滑进本音）写 !bend!、注（往下落）写 !fall!、吟猱（揉弦）写 !vib!。
import type { RegionalDef } from "./types";

export const GUQIN: RegionalDef = {
  key: "guqin",
  region: "ming",
  name: { zh: "古琴", en: "Guqin" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 5,
      tilt: 0.35,
      bright: 0.42,
      pick: 0.11,
      damp: 0.31,
      thump: 0.03,
      body: [[98, 1.3, 5], [210, 1.4, 3], [520, 1.3, 1], [1600, 1, -3]],
      lp: 4200,
      max: 6,
    },
    level: 0.76,
    release: 1.4,
  },
  // 正调（C D F G A c d）的散音，按音的绰与吟猱
  demo: { key: "F major", qpm: 60, bars: 3, abc: "C,,2 F,,2 G,,2 C,2 | !bend!F,3 G, !vib!A,4 | !fall!C4 !vib!F,4" },
};
