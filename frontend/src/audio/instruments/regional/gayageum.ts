// 伽倻琴（朝鲜）：十二根丝弦、桐木挖空的长琴身，不戴义甲、用指肉弹——起音比日本的筝圆、软，余音温而长；
// 左手在雁足（琴码）左边按弦：弄弦（농현，又深又慢的揉弦）写 !vib!，推上去（推声）写 !bend!，落下来（退声）写 !fall!，
// 南道调里从 do 往 si “折”下来的音（꺾는 음）写倚音 {c}B。散调与民谣里长音大多要揉，可界面调里 la 平着弹、mi 揉得最深——揉在哪个音上、揉多深，是它一听就知道的颜色。
import type { RegionalDef } from "./types";

export const GAYAGEUM: RegionalDef = {
  key: "gayageum",
  region: "korea",
  name: { zh: "伽倻琴", en: "Gayageum" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 2.7,
      tilt: 0.5,
      bright: 0.42,
      pick: 0.22,
      damp: 0.25,
      thump: 0.1,
      body: [[150, 1, 3], [380, 1.2, 4], [1100, 1.3, 1], [2600, 1.1, 2]],
      lp: 6500,
      max: 4,
    },
    level: 0.86,
    // 弄弦：每秒四下多、上下约半个半音，弹下去一小会儿以后才揉开
    vib: { rate: 4.3, depth: 0.03, delay: 0.14 },
  },
  // 南道的界面调（la 平、mi 揉、do 折到 si）：弄弦、折音、推声
  demo: { key: "A minor", qpm: 76, bars: 4, abc: "E2 A2 c2 !vib!e2 | d c {c}B2 A4 | !bend!c2 A2 E2 {G}E D | !vib!E8" },
};
