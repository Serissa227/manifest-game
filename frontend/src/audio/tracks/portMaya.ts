// 《可可与玉米的市》：玛雅的港口（尤卡坦的海岸、科苏梅尔岛、梅里达附近的市——可可豆当钱用，盐、蜂蜜、棉布与玉米）。
// 地方特色第一阶段重编：玛雅的乐器领奏（复古合成版的衬底只有很轻的合成持续音）。旋律沿用第三轮的原创旋律。
// G 小调五声（G 降B C D F），6/8 拍的“六三交替”（单数小节两个附点四分、双数小节三个四分），每分钟 116 拍：
// - 引子：海螺号吹两声长音（音头从下面推上来），葫芦沙铃与龟甲先进来，裂缝木鼓（屯库尔，G 与 D 两片舌头）接上；
// - A：陶笛领奏，再来时第二支陶笛在下方三度跟着（玛雅的双管陶笛）；
// - B：第二支陶笛唱，帕克斯鼓（立鼓，手打）的低音与掌拍；再一遍两支一起、海螺号在下面拉长音；
// - 尾声海螺号再吹一声。
// 和声不用西洋的三和弦：只有空五度的持续音。
import type { TrackDef } from "../score";

/** 裂缝木鼓：单数小节 6/8（咚 · 咚 嗒 · 嗒），双数小节 3/4（咚 · 嗒 · 咚 ·）。 */
const slit = (bars: number) => Array.from({ length: bars }, (_, i) => (i % 2 === 0 ? "G,,2 G,, D,2 D," : "G,,2 D,2 G,,2")).join(" | ");

export const PORT_MAYA: TrackDef = {
  id: "port_maya",
  title: { zh: "可可与玉米的市", en: "Market of Cacao and Maize" },
  qpm: 116,
  meter: [6, 8],
  key: "G minor",
  voices: {
    ocarina: { inst: "ocarina", gain: 0.52, pan: -0.12, reverb: 0.32 },
    ocarina2: { inst: "ocarina", gain: 0.42, pan: 0.16, reverb: 0.34 },
    conch: { inst: "conch", gain: 0.36, pan: -0.04, reverb: 0.52 },
    slit: { inst: "tunkul", gain: 0.4, pan: 0.24, reverb: 0.24 },
    shell: { inst: "perc", gain: 0.26, pan: -0.26, reverb: 0.22, pattern: { kind: "drum", steps: "h..l.h l.h.h.", hits: { h: ["ayotl_hi", 0.6], l: ["ayotl_lo", 0.55] } } },
    rattle: { inst: "perc", gain: 0.28, pan: 0.3, reverb: 0.2, pattern: { kind: "drum", steps: "Ssssss S.s.s.", hits: { S: ["sonaja", 0.5], s: ["sonaja", 0.3] } } },
    drum: { inst: "perc", gain: 0.3, pan: 0.04, reverb: 0.24, pattern: { kind: "drum", steps: "P..s.. P.s.P.", hits: { P: ["pax", 0.65], s: ["pax_slap", 0.45] } } },
    // 衬底（合成）：很轻的空五度持续音
    pad: { inst: "drone", gain: 0.14, pan: -0.2, reverb: 0.44, pattern: { kind: "pad", low: 55, high: 70, size: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "G5 | G5 | G5 | G5",
      lines: { call: "!bend!G,6 | z6 | !bend!G,3 !bend!D3 | !fall!G,6", slit: "z6 | z6 | z6 | G,,2 D,2 G,,2" },
    },
    A: {
      bars: 8,
      chords: "G5 | F5 | G5 | D5 | G5 | Bb5 | C5*3 F5*3 | G5",
      lines: {
        mel: "d3 B c d | c2 F2 c2 | B3 G3 | d2 f2 d2 | g3 f d c | d2 B2 F2 | c3 F3 | G2 B2 G2",
        slit: slit(8),
      },
    },
    B: {
      bars: 8,
      chords: "Bb5 | F5 | G5 | D5 | Bb5 | F5 | C5 | G5",
      lines: {
        bmel: "f3 d3 | c2 d2 f2 | g3 f d c | d6 | f3 g f d | c2 d2 c2 | c3 B G F | G6",
        slit: slit(8),
        // 海螺号在下面拉长音（空五度的根音）
        horn: "!bend!B,6 | F,6 | !bend!G,6 | D6 | !bend!B,6 | F,6 | C6 | !fall!G,6",
      },
    },
    coda: { bars: 2, chords: "G5 | G5", lines: { call: "!bend!G,6- | G,3 z3" } },
  },
  forms: [
    [
      { s: "intro", play: "call:conch slit:slit shell rattle pad", dyn: 0.62 },
      { s: "A", play: "mel:ocarina slit:slit shell rattle drum pad", dyn: 0.64 },
      { s: "A", play: "mel:ocarina mel:ocarina2~-2 slit:slit shell rattle drum pad", dyn: 0.66 },
      { s: "B", play: "bmel:ocarina2 slit:slit rattle drum pad", dyn: 0.64 },
      { s: "B", play: "bmel:ocarina bmel:ocarina2~-2 horn:conch slit:slit shell rattle drum pad", dyn: 0.68 },
      { s: "A", play: "mel:ocarina slit:slit shell rattle drum pad", dyn: 0.66, rit: 0.92 },
      { s: "coda", play: "call:conch rattle pad", dyn: 0.62 },
    ],
    [
      { s: "A", play: "mel:ocarina2 slit:slit rattle drum pad", dyn: 0.62 },
      { s: "B", play: "bmel:ocarina slit:slit shell rattle drum pad", dyn: 0.66 },
      { s: "A", play: "mel:ocarina mel:ocarina2~-2 slit:slit shell rattle drum pad", dyn: 0.68, rit: 0.92 },
      { s: "coda", play: "call:conch rattle pad", dyn: 0.62 },
    ],
  ],
  rest: [10, 18],
  level: 1.25,
};
