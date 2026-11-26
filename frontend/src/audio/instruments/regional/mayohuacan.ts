// 马约瓦坎（加勒比泰诺人的大木鼓）：一整段挖空的大树干，上面开出 H 形的缝，两片舌头两个音；用两根硬木棍敲——
// 起音硬、亮（棍子的“哒”），木头的空响比阿兹特克的特波纳兹特利（橡胶槌）短、硬，分音更多；阿雷伊托（泰诺人的歌舞）的骨架由它敲出来。
// 棍子敲在鼓身的木头上是“嗒”（mayo_rim）。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const MAYOHUACAN: RegionalDef = {
  key: "mayohuacan",
  region: "taino",
  name: { zh: "马约瓦坎木鼓", en: "Mayohuacán (log drum)" },
  instrument: {
    kind: "mallet",
    spec: {
      partials: [[1, 1, 0.42], [2.31, 0.32, 0.12], [3.65, 0.14, 0.06], [5.4, 0.07, 0.03]],
      attack: 0.0012,
      strike: [0.45, 0.003, 4200],
      tilt: 0.2,
      max: 1.2,
    },
    level: 1.28,
  },
  drums: {
    mayo_rim: { layers: [skin(980, 960, 0.005, 0.045, 0.6, [[1.83, 0.3, 0.03]], 0.0003), hiss(2000, 7000, 0.004, 0.45, { attack: 0.0015 })] },
  },
  // 低舌 F、高舌 C：三 + 三 + 二（低 · · 低 · · 高 ·），鼓身的“嗒”在空处
  demo: {
    key: "F major",
    qpm: 104,
    bars: 3,
    abc: "F,3 F,3 C2 | F,3 F, C C F,2 | F,3 F,3 C2",
    drum: [{ steps: "..r...r...r..r.r..r...r.", hits: { r: ["mayo_rim", 0.5] } }],
  },
};
