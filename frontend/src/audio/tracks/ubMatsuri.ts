// 《夏祭的囃子》：养成篇的节日·日本（祇园会的山鉾、盂兰盆的风流踊、各町的神社祭礼……）。旋律原创。
// 第二阶段（东亚宫廷）：主角是日本文化区时（养成摘要的 culture），节日放这一首代替《节日的街》。
// A 上的阳音阶（A B D E 升F，民谣与祭囃子的音阶），4/4（每分钟 120 拍），祭囃子的编制：
// - 引子：拍子木越敲越密（开场的“柝”），太鼓滚起来；
// - A：篠笛领奏（手指“打”出来的倚音），当钲“锵 · 吉吉 · 锵 锵 吉吉 ·”一直响着，缔太鼓碎、太鼓“咚 · 咚哒”；
//   再来时三味线低八度跟着弹同一条旋律（异音）；
// - B：盂兰盆夜里的踊——篠笛在高处拉长了唱，鼓收小，三味线跟着；
// - A″：全体，太鼓密起来；尾声篠笛一声、太鼓三下、拍子木收。
// 和声不写和弦：只有极轻的 A–E 持续音与低音的拨奏（管弦版换成管弦的长音与拨奏）。
import type { TrackDef } from "../score";

/** 当钲：锵 · 吉吉 · 锵 锵 吉吉 ·（一小节），重复 n 小节。 */
const kane = (bars: number) => Array.from({ length: bars }, () => "e' e'/2e'/2 z e' e' e'/2e'/2 z e'").join(" | ");

export const UB_MATSURI: TrackDef = {
  id: "ub_matsuri",
  title: { zh: "夏祭的囃子", en: "Summer Festival Bayashi" },
  qpm: 120,
  meter: [4, 4],
  key: "A dorian",
  level: 1.1,
  voices: {
    fue: { inst: "shinobue", gain: 0.46, pan: -0.12, reverb: 0.32 },
    shami: { inst: "shamisen", gain: 0.42, pan: 0.2, reverb: 0.26 },
    kane: { inst: "atarigane", gain: 0.18, pan: 0.3, reverb: 0.24 },
    shime: {
      inst: "perc",
      gain: 0.22,
      pan: -0.18,
      reverb: 0.26,
      pattern: {
        a: { kind: "drum", grid: 0.5, steps: "S.ssS.s.S.ssS.sS", hits: { S: ["shime", 0.72], s: ["shime", 0.42] } },
        b: { kind: "drum", grid: 0.5, steps: "S...S.s.S...S.s.", hits: { S: ["shime", 0.6], s: ["shime", 0.36] } },
      },
    },
    taiko: {
      inst: "perc",
      gain: 0.3,
      pan: 0.04,
      reverb: 0.32,
      pattern: {
        a: { kind: "drum", grid: 0.5, steps: "D...D.d.D...D.k.", hits: { D: ["taiko_don", 0.82], d: ["taiko_don", 0.45], k: ["taiko_ka", 0.55] } },
        b: { kind: "drum", grid: 0.5, steps: "D.......D...k...", hits: { D: ["taiko_don", 0.62], k: ["taiko_ka", 0.4] } },
        full: { kind: "drum", grid: 0.5, steps: "D.dkD.kdD.dkDdDk", hits: { D: ["taiko_don", 0.86], d: ["taiko_don", 0.5], k: ["taiko_ka", 0.6] } },
        intro: { kind: "drum", grid: 0.5, steps: ".".repeat(16) + "D.D.D.DdDdDdDdDd", hits: { D: ["taiko_don", 0.8], d: ["taiko_don", 0.5] } },
        coda: { kind: "drum", grid: 0.5, steps: "D...D...D.......D...............", hits: { D: ["taiko_don", 0.92] } },
      },
    },
    hyo: {
      inst: "perc",
      gain: 0.26,
      pan: -0.3,
      reverb: 0.34,
      pattern: {
        intro: { kind: "drum", steps: "h...h...h.h.hhhh", hits: { h: ["hyoshigi", 0.8] } },
        coda: { kind: "drum", steps: "........h.......", hits: { h: ["hyoshigi", 0.9] } },
      },
    },
    // 衬底（合成）：极轻的 A–E 持续音、低音的拨奏
    bed: { inst: "drone", gain: 0.08, pan: -0.06, reverb: 0.4, pattern: { kind: "drone", notes: [45, 52] } },
    thud: { inst: "pizz", gain: 0.24, pan: 0.06, reverb: 0.2 },
  },
  sections: {
    intro: { bars: 2, lines: { fue: "z8 | z4 !bend!e'2 a'2" } },
    A: {
      bars: 8,
      lines: {
        mel: "a2 a f e2 f2 | a b a f e4 | d2 d e f2 e d | B2 A2 B4 | d2 d e f2 a2 | b a f e d2 e2 | f2 e d B2 A2 | A6 z2",
        fue: "{b}a2 a f e2 {f}e2 | a b a f !bend!e4 | d2 d e {a}f2 e d | B2 A2 !vib!B4 | d2 d e {a}f2 a2 | b a f e d2 {f}e2 | f2 e d B2 A2 | !vib!A6 z2",
        kane: kane(8),
        low: "A,,2 z6 | z8 | D,,2 z6 | z8 | D,,2 z6 | z8 | E,,2 z6 | A,,2 z6",
      },
    },
    B: {
      bars: 8,
      lines: {
        bmel: "e'4 d'2 b2 | a4 b2 d'2 | e'2 d'2 b2 a2 | b6 z2 | a4 f2 e2 | f4 a2 b2 | a2 f2 e2 d2 | e6 z2",
        fue: "!bend!e'4 d'2 b2 | a4 {d'}b2 d'2 | e'2 d'2 b2 a2 | !vib!b6 z2 | !bend!a4 f2 e2 | f4 {b}a2 b2 | a2 f2 e2 d2 | !vib!e6 z2",
        low: "E,,2 z6 | z8 | A,,2 z6 | z8 | A,,2 z6 | z8 | E,,2 z6 | E,,2 z6",
      },
    },
    coda: {
      bars: 2,
      lines: {
        fue: "e'2 d'2 b2 {b}a2 | a2 z6",
        end: "A,2 z2 [A,EA]2 z2 | z8",
        low: "A,,2 z6 | A,,2 z6",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "fue:fue taiko.intro hyo.intro bed", dyn: 0.66, to: 0.72 },
      { s: "A", play: "fue:fue kane:kane shime taiko low:thud bed", dyn: 0.7 },
      { s: "A", play: "fue:fue mel:shami-12 kane:kane shime taiko low:thud bed", dyn: 0.72 },
      { s: "B", play: "fue:fue bmel:shami-12 shime.b taiko.b low:thud bed", dyn: 0.66 },
      { s: "A", play: "fue:fue mel:shami-12 kane:kane shime taiko.full low:thud bed", dyn: 0.76 },
      { s: "coda", play: "fue:fue end:shami taiko.coda hyo.coda low:thud", dyn: 0.78, rit: 0.92 },
    ],
    [
      { s: "A", play: "fue:fue shime low:thud bed", dyn: 0.66 },
      { s: "B", play: "fue:fue bmel:shami-12 shime.b taiko.b low:thud bed", dyn: 0.66 },
      { s: "A", play: "fue:fue mel:shami-12 kane:kane shime taiko.full low:thud bed", dyn: 0.76 },
      { s: "coda", play: "fue:fue end:shami taiko.coda hyo.coda low:thud", dyn: 0.78, rit: 0.92 },
    ],
  ],
  rest: [8, 14],
};
