// 筝（日本的十三弦筝）：象牙的爪拨在弦的一端，起音“咔”地一亮，桐木的长琴身，余音长而温。
// 左手在琴码左边按弦：后押（拨了以后按上去）写 !bend!，揉弦（yuri）写 !vib!。与旧的 zheng（古筝）分开：那件更亮、更“铮”。
import type { RegionalDef } from "./types";

export const KOTO: RegionalDef = {
  key: "koto",
  region: "japan",
  name: { zh: "筝（日本）", en: "Koto" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 3.0,
      tilt: 0.5,
      bright: 0.78,
      pick: 0.09,
      damp: 0.17,
      thump: 0.1,
      body: [[175, 1, 3], [430, 1.3, 3], [1600, 1.4, 2], [3300, 1.1, 3]],
      lp: 9000,
      max: 4.5,
    },
    level: 0.9,
  },
  // 平调子一类的阴音阶（D E♭ G A B♭）：分解、后押、揉弦
  demo: { key: "D phrygian", qpm: 84, bars: 4, abc: "D2 G2 A2 B2 | d4 !bend!e2 d2 | A2 G A !vib!B4 | !vib!D8" },
};
