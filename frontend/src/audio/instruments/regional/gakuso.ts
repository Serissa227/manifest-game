// 乐筝（日本雅乐的十三弦筝，gakusō）：也是“节奏的骨架”——不奏旋律，按固定的手型“閑掻”（shizugaki）一拍拍地拨：
// 两根相邻的弦一前一后、再一根高八度的弦，像水滴落在石上。戴竹的义甲，比俗筝（koto）暗、钝、余音短一点，左手不按弦（没有后押与揉弦）。
import type { RegionalDef } from "./types";

export const GAKUSO: RegionalDef = {
  key: "gakuso",
  region: "japan",
  name: { zh: "乐筝", en: "Gakusō" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 2.4,
      tilt: 0.5,
      bright: 0.6,
      pick: 0.13,
      damp: 0.23,
      thump: 0.15,
      body: [[150, 1, 3], [400, 1.2, 3], [1300, 1.3, 2], [2900, 1.1, 1]],
      lp: 7200,
      max: 4,
    },
    level: 0.92,
    release: 0.9,
  },
  // 閑掻：低—高（相邻两弦）—高八度，一拍一组
  demo: { key: "E dorian", qpm: 60, bars: 3, abc: "E/2F/2 e B/2c/2 b A/2B/2 a E/2F/2 e | B,/2E/2 B B/2c/2 b E/2F/2 e z2 | E/2F/2 e7" },
};
