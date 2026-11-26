// 《町家与潮风》：日本的港町（堺、博多、平户、坊津……白天的町家与市）。
// 地方特色第一阶段重编：地方乐器领奏（复古合成版的衬底用合成的弦乐与持续音）。
// E 上的都节音阶（E F A B C，偶尔经过 D；日本的“阴”音阶，半音 E–F、B–C 是它一听就知道的颜色），4/4（每分钟 100 拍），民谣的二拍子律动：
// - 引子：拍子木“柝”两响，尺八一句（meri 从下面上来、yuri 揉开），留白（间），太鼓滚起来，筝从低到高一划；
// - A：三味线领奏（拨子打在皮上的重音、sawari 的嗡、勾弦），太鼓“咚 · · · 咚 · 咚”、缔太鼓的碎点；
// - A′：尺八与三味线异音齐奏（尺八拉长、推音，三味线照样碎），筝的分解；
// - B：转到 A 上的都节音阶（降 B，日本音乐里常见的上四度转调），尺八唱、筝铺、小鼓“噗——哒”，留白多；
// - A″：三味线与高八度的篠笛，太鼓、缔太鼓、当钲（祭囃子的“锵—吉”）全上；尾声三味线一扫、太鼓三下、拍子木收。
// 和声不用西洋的大小三和弦：只有空五度的持续音（E–B、A–E、F–C、D–A）。
import type { TrackDef } from "../score";

/** 当钲：锵 · 吉吉 吉 锵 · 吉 · */
const kane = (bars: number) => Array.from({ length: bars }, () => "e'2 e'/2e'/2 e' e'2 e' z").join(" | ");

export const PORT_JAPAN: TrackDef = {
  id: "port_japan",
  title: { zh: "町家与潮风", en: "Townhouses and Sea Breeze" },
  qpm: 100,
  meter: [4, 4],
  key: "E phrygian",
  voices: {
    shami: { inst: "shamisen", gain: 0.6, pan: -0.12, reverb: 0.22 },
    shaku: { inst: "shakuhachi", gain: 0.55, pan: 0.16, reverb: 0.4 },
    koto: { inst: "koto", gain: 0.4, pan: 0.3, reverb: 0.32, pattern: { kind: "arp", low: 52, steps: "1 5 8 . 5 8 12 .", ring: 2 } },
    fue: { inst: "shinobue", gain: 0.4, pan: -0.24, reverb: 0.34 },
    kane: { inst: "atarigane", gain: 0.2, pan: 0.32, reverb: 0.24 },
    taiko: {
      inst: "perc",
      gain: 0.3,
      pan: 0.04,
      reverb: 0.32,
      pattern: {
        a: { kind: "drum", steps: "D...D.d.", hits: { D: ["taiko_don", 0.85], d: ["taiko_don", 0.45] } },
        b: { kind: "drum", steps: "D.dkD.k.D.dkDdDk", hits: { D: ["taiko_don", 0.9], d: ["taiko_don", 0.5], k: ["taiko_ka", 0.6] } },
        intro: { kind: "drum", steps: "........................D.D.DdDd", hits: { D: ["taiko_don", 0.8], d: ["taiko_don", 0.5] } },
        coda: { kind: "drum", steps: "D.D.D...D.......", hits: { D: ["taiko_don", 0.95] } },
      },
    },
    shime: { inst: "perc", gain: 0.22, pan: -0.18, reverb: 0.26, pattern: { kind: "drum", grid: 0.5, steps: "S.s.S.ssS.s.SsS.", hits: { S: ["shime", 0.7], s: ["shime", 0.4] } } },
    tsuzumi: { inst: "perc", gain: 0.3, pan: 0.22, reverb: 0.4, pattern: { kind: "drum", steps: "P.......t...P.t.", hits: { P: ["tsuzumi_pon", 0.8], t: ["tsuzumi_ta", 0.7] } } },
    hyo: {
      inst: "perc",
      gain: 0.26,
      pan: -0.3,
      reverb: 0.36,
      pattern: {
        intro: { kind: "drum", steps: "h.......h...............h..h.hhh", hits: { h: ["hyoshigi", 0.8] } },
        coda: { kind: "drum", steps: "........h.......", hits: { h: ["hyoshigi", 0.9] } },
      },
    },
    // 衬底（合成）：空五度的持续音、大提琴组的长音
    pad: { inst: "drone", gain: 0.2, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 52, high: 71, size: 2 } },
    low: { inst: "celli", gain: 0.2, pan: 0.12, reverb: 0.26, pattern: { kind: "arp", low: 40, steps: "1 . . . . . . .", ring: 8 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "E5 | E5 | E5 | E5",
      lines: {
        call: "!bend!B4 {c}B2 A2 | !vib!A6 F E | !bend!B6 z2 | z8",
        gliss: "z8 | z8 | z8 | E,/2F,/2A,/2B,/2 C/2E/2F/2A/2 B/2c/2e/2f/2 e2",
      },
    },
    A: {
      bars: 8,
      chords: "E5 | E5 | A5 | E5 | E5 | E5 | A5 | E5",
      lines: {
        mel: "e2 {f}e c B2 A2 | B c B A F2 E2 | A2 A B c2 {d}c B | !slide!B6 z2 | e e e2 f2 e c | B2 c B A2 F2 | E F A B c2 B A | !slide!E6 z2",
        // 尺八的异音：同一条旋律拉长、推上去
        long: "!bend!e4 c B A2 | !vib!B4 F2 E2 | A4 !bend!c4 | !vib!B6 z2 | !bend!e4 f e c2 | B4 A2 F2 | E2 A2 B c B A | !fall!E6 z2",
        kane: kane(8),
      },
    },
    B: {
      bars: 8,
      // 转到 A 上的都节音阶（A 降B D E F）
      chords: "A5 | F5 | D5 | A5 | A5 | F5 | E5 | E5",
      lines: { bmel: "!bend!A4 _B2 A2 | !vib!F6 z2 | D2 E2 F2 E D | !bend!E8 | z2 a2 !bend!_b4 | a2 f2 e2 d2 | e4 !bend!f2 e2 | !fall!B6 z2" },
    },
    coda: {
      bars: 2,
      chords: "E5 | E5",
      lines: { end: "!slide!e2 z2 [E,B,E]2 z2 | z8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:shaku gliss:koto taiko.intro hyo.intro pad", dyn: 0.62, to: 0.7 },
      { s: "A", play: "mel:shami taiko.a shime low pad", dyn: 0.68 },
      { s: "A", play: "mel:shami long:shaku koto taiko.a shime low pad", dyn: 0.7 },
      { s: "B", play: "bmel:shaku koto tsuzumi low pad", dyn: 0.62 },
      { s: "A", play: "mel:shami mel:fue+12 kane:kane taiko.b shime low pad", dyn: 0.74 },
      { s: "coda", play: "end:shami taiko.coda hyo.coda low", dyn: 0.76, rit: 0.9 },
    ],
    [
      { s: "A", play: "mel:koto long:shaku tsuzumi low pad", dyn: 0.64 },
      { s: "B", play: "bmel:shaku koto tsuzumi low pad", dyn: 0.62 },
      { s: "A", play: "mel:shami mel:fue+12 kane:kane taiko.b shime low pad", dyn: 0.72 },
      { s: "coda", play: "end:shami taiko.coda hyo.coda low", dyn: 0.74, rit: 0.9 },
    ],
  ],
  rest: [10, 18],
  level: 1.2,
};
