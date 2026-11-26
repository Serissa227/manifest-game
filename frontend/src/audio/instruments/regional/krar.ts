// 克拉尔琴（埃塞俄比亚）：五六根弦的里拉琴，碗形的琴箱蒙着皮；阿兹马里（游吟的歌手）用拨片一扫、左手手指按住不要的弦，
// 只让一根响，或者用手指拨。声音亮、脆，带一点皮面的“咚”，余音不长；按五声的“格涅特”（qenet）调弦——
// 提兹塔、巴蒂、安巴塞尔、安奇霍耶，换一种格涅特就重调一次弦。
import type { RegionalDef } from "./types";

export const KRAR: RegionalDef = {
  key: "krar",
  region: "ethiopia",
  name: { zh: "克拉尔琴", en: "Krar" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 1.6,
      tilt: 0.42,
      bright: 0.86,
      pick: 0.1,
      damp: 0.12,
      thump: 0.09,
      skin: [210, 0.05, 0.2],
      body: [[240, 1.3, 4], [1300, 1.3, 3], [3300, 1.2, 3]],
      lp: 10000,
      max: 2.6,
    },
    level: 1.17,
  },
  // 安奇霍耶（E F A 降B 升C）：一扫一拨，小三度、增二度的颜色
  demo: { key: "E phrygian", qpm: 104, bars: 4, abc: "E F A _B ^c2 _B A | F2 E F A4 | ^c e ^c _B A F E F | E8" },
};
