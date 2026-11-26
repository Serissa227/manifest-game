// 《花与歌》：阿兹特克（墨西加）与纳瓦人的城（湖上的城、韦拉克鲁斯一带的纳瓦人市镇；曲名取纳瓦特尔语的 in xochitl in cuicatl“花与歌”——诗与歌舞）。
// 地方特色第二阶段·美洲：阿兹特克的乐器领奏（复古合成版的衬底只有很轻的合成持续音）。旋律原创。
// D 小调五声（D F G A C），5/4 拍（每分钟 108 拍），一小节十个八分音符按 2 + 3 + 2 + 3 分组——
// 这是祭歌的鼓点音节“to-co ti-qui-ti to-co ti-qui-ti”：特波纳兹特利的低舌（to，D）与高舌（ti，F，小三度），
// 韦韦特尔立鼓“咚 · 嗒嗒 · 咚 · 嗒 · 嗒”跟着同一个分组，舞者脚踝上的果壳串落在每组的头上，响杖在小节头上一顿；
// B 段的长音上与尾声里，骨刮（奥米奇卡瓦兹特利）“咯—咯—咯”地刮一长两短。
// - 引子：海螺号（atecocolli）吹两声，风哨在空处一声长啸，木鼓与立鼓滚进来；
// - A：陶笛领奏（鸟叫似的倚音、重复的音、四度的跳）；再来时第二支陶笛在下方四度平行着走（双管、三管陶笛的那种空的四度）；
// - B：第二支陶笛唱低一些的一句，风哨在长音处两声，立鼓换成更密的“ti-qui-ti”；再一遍两支一起，海螺号在下面拉长音；
// - 尾声海螺号再吹一声，木鼓收住。
// 和声不用西洋的三和弦：只有空五度的持续音。
import type { TrackDef } from "../score";

/** 特波纳兹特利：两种小节轮流——“to co ti · ti to co ti qui ·”与“to·· ti qui ti to·· ti · ti”。 */
const tepo = (bars: number) => Array.from({ length: bars }, (_, i) => (i % 2 === 0 ? "D, D, F, z F, D, D, F, F, z" : "D,2 F, F, F, D,2 F, z F,")).join(" | ");

export const PORT_AZTEC: TrackDef = {
  id: "port_aztec",
  title: { zh: "花与歌", en: "Flower and Song" },
  qpm: 108,
  meter: [5, 4],
  key: "D minor",
  voices: {
    flute: { inst: "tlapitzalli", gain: 0.5, pan: -0.12, reverb: 0.34 },
    flute2: { inst: "tlapitzalli", gain: 0.4, pan: 0.18, reverb: 0.36 },
    wind: { inst: "ehecachichtli", gain: 0.24, pan: 0.3, reverb: 0.55 },
    conch: { inst: "conch", gain: 0.36, pan: -0.04, reverb: 0.5 },
    tepo: { inst: "teponaztli", gain: 0.44, pan: 0.22, reverb: 0.26 },
    huehue: {
      inst: "perc",
      gain: 0.3,
      pan: 0.02,
      reverb: 0.3,
      pattern: {
        a: { kind: "drum", steps: "H.tt.H.t.t", hits: { H: ["huehuetl", 0.8], t: ["huehuetl_ti", 0.5] } },
        b: { kind: "drum", steps: "H.tttH.tHt", hits: { H: ["huehuetl", 0.85], t: ["huehuetl_ti", 0.55] } },
        intro: { kind: "drum", steps: "H.........H.........H.tt.H.t.tH.tt.HtHtH", hits: { H: ["huehuetl", 0.75], t: ["huehuetl_ti", 0.45] } },
        coda: { kind: "drum", steps: "H....H....H.........", hits: { H: ["huehuetl", 0.9] } },
      },
    },
    ayo: { inst: "perc", gain: 0.26, pan: -0.3, reverb: 0.24, pattern: { kind: "drum", steps: "A.a..A.a..", hits: { A: ["ayoyotl", 0.6], a: ["ayoyotl_soft", 0.45] } } },
    staff: { inst: "perc", gain: 0.24, pan: 0.32, reverb: 0.3, pattern: { kind: "drum", steps: "C....s....", hits: { C: ["chicahuaztli", 0.6], s: ["chicahuaztli_shake", 0.4] } } },
    shell: { inst: "perc", gain: 0.2, pan: -0.18, reverb: 0.24, pattern: { kind: "drum", steps: "...h...l.h", hits: { h: ["ayotl_hi", 0.5], l: ["ayotl_lo", 0.45] } } },
    // 骨刮：只在 B 段每四小节的长音上刮一长两短，尾声再刮一下（祭歌里低沉的一面）
    bone: {
      inst: "perc",
      gain: 0.24,
      pan: -0.34,
      reverb: 0.34,
      pattern: {
        b: { kind: "drum", steps: `${".".repeat(30)}L....s.s..${".".repeat(30)}L....s.s..`, hits: { L: ["omichicahuaztli", 0.6], s: ["omichicahuaztli_short", 0.4] } },
        coda: { kind: "drum", steps: `L....s.s..${".".repeat(10)}`, hits: { L: ["omichicahuaztli", 0.55], s: ["omichicahuaztli_short", 0.36] } },
      },
    },
    // 衬底（合成）：很轻的空五度持续音
    pad: { inst: "drone", gain: 0.14, pan: -0.2, reverb: 0.44, pattern: { kind: "pad", low: 50, high: 69, size: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "D5 | D5 | D5 | D5",
      lines: {
        call: "!bend!D,8 z2 | z10 | !bend!A,,8 z2 | !bend!D,6 z4",
        cry: "z10 | z3 !bend!a7 | !fall!f6 z4 | z10",
        tepo: `z10 | z10 | ${tepo(2)}`,
      },
    },
    A: {
      bars: 8,
      chords: "D5 | D5 | D5 | G5 | D5 | D5 | C5 | D5",
      lines: {
        mel: "A2 {c}d3 c2 A3 | G2 A3 F2 D3 | F2 G A2 c2 d2 A | !vib!G8 z2 | {f}d2 f3 d2 c A2 | A2 c3 A2 G3 | F2 G3 A2 c d2 | !fall!D8 z2",
        tepo: tepo(8),
      },
    },
    B: {
      bars: 8,
      chords: "F5 | F5 | G5 | C5 | F5 | D5 | G5 | D5",
      lines: {
        bmel: "F2 F3 G2 A3 | c2 A3 G2 F3 | G2 A2 G F2 D3 | !vib!C8 z2 | F2 A3 c2 d3 | f2 d3 c2 A3 | G2 A3 F2 G D2 | !fall!D8 z2",
        cry: "z10 | z5 !bend!a5 | !fall!f8 z2 | z10 | z10 | z5 !bend!c'5 | !fall!a8 z2 | z10",
        // 海螺号在下面拉长音（空五度的根音）
        horn: "!bend!F,10 | z10 | !bend!G,10 | z10 | !bend!F,10 | z10 | !bend!G,10 | !fall!D,10",
        tepo: tepo(8),
      },
    },
    coda: {
      bars: 2,
      chords: "D5 | D5",
      lines: { call: "!bend!D,8 z2 | !fall!D,6 z4", tepo: "D, D, F, z F, D,2 z3 | D,2 z8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:conch cry:wind tepo:tepo huehue.intro pad", dyn: 0.6, to: 0.68 },
      { s: "A", play: "mel:flute tepo:tepo huehue.a ayo staff pad", dyn: 0.66 },
      { s: "A", play: "mel:flute mel:flute2-5 tepo:tepo huehue.a ayo staff shell pad", dyn: 0.68 },
      { s: "B", play: "bmel:flute2 cry:wind tepo:tepo huehue.b staff bone.b pad", dyn: 0.64 },
      { s: "B", play: "bmel:flute bmel:flute2-5 horn:conch cry:wind tepo:tepo huehue.b ayo staff shell bone.b pad", dyn: 0.7 },
      { s: "A", play: "mel:flute tepo:tepo huehue.a ayo staff shell pad", dyn: 0.68, rit: 0.92 },
      { s: "coda", play: "call:conch tepo:tepo huehue.coda staff bone.coda pad", dyn: 0.66 },
    ],
    [
      { s: "A", play: "mel:flute2 tepo:tepo huehue.a ayo pad", dyn: 0.64 },
      { s: "B", play: "bmel:flute cry:wind tepo:tepo huehue.b staff bone.b pad", dyn: 0.66 },
      { s: "A", play: "mel:flute mel:flute2-5 tepo:tepo huehue.a ayo staff shell pad", dyn: 0.7, rit: 0.92 },
      { s: "coda", play: "call:conch tepo:tepo huehue.coda staff bone.coda pad", dyn: 0.66 },
    ],
  ],
  rest: [10, 18],
  level: 1.2,
};
