// 恩桑比（刚果的弓琴，pluriarc）：木箱上插着五六根弯弓，每根弓上一根棕榈纤维的弦；1591 年帕加费塔记刚果宫廷的“琉特”，
// 说的就是它。弦软、箱小，拨出来温暖、闷、余音短，像在耳边说话；两手拇指拨出几个音的伴奏型，歌者一边弹一边唱。
import type { RegionalDef } from "./types";

export const NSAMBI: RegionalDef = {
  key: "nsambi",
  region: "kongo",
  name: { zh: "恩桑比（弓琴）", en: "Nsambi (pluriarc)" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 1.1,
      tilt: 0.4,
      bright: 0.45,
      pick: 0.24,
      damp: 0.3,
      thump: 0.06,
      body: [[190, 1.2, 5], [760, 1.4, 2], [2100, 1.1, -2]],
      lp: 4800,
      max: 2,
    },
    level: 1.08,
  },
  demo: { key: "G major", qpm: 100, bars: 4, abc: "G,2 D B, D G, A, D | E,2 B, G, B, E, D, E, | G,2 D B, D G, E D | G,8" },
};
