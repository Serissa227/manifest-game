// 弯琴（saung gauk，缅甸的弓形竖琴）：船形的琴身蒙着鹿皮，一根弯弯的长颈挑着十三到十六根丝弦，手指拨，声音细、暖、带木头的空；
// 左手在弦根上一压，音高往上一推（写 !bend!）——宫廷的“大歌”（mahagita）与室内乐的乐器，安静、讲究。
import type { RegionalDef } from "./types";

export const SAUNG_GAUK: RegionalDef = {
  key: "saung_gauk",
  region: "burma",
  name: { zh: "弯琴（缅甸竖琴）", en: "Saung gauk" },
  instrument: {
    kind: "pluck",
    // 丝弦：比西洋竖琴余音短、暗一些；船形琴身的低音共鸣与皮面的中音
    spec: { t60: 2.0, tilt: 0.5, bright: 0.55, pick: 0.22, damp: 0.25, thump: 0.035, body: [[210, 1.1, 4], [560, 1.3, 3], [1500, 1.2, -2], [2800, 1, 1]], lp: 7000, max: 3.2 },
    level: 0.99,
  },
  demo: { key: "C major", qpm: 84, bars: 3, abc: "C E G c e2 d c | !bend!A4 G E D2 | C D E G !vib!c4" },
};
