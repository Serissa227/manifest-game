// 《岛上的阿雷伊托》：加勒比的港口（圣多明各、圣胡安、哈瓦那……泰诺人的岛上开了西班牙人的糖坊与港口，非洲来的人也到了）。
// 阿雷伊托（areíto）是泰诺人的歌舞：领唱的人（tequina）唱一句，围成圈的众人接一句，马约瓦坎木鼓、马拉卡、刮瓜一直响着。
// 地方特色第二阶段·美洲：泰诺的乐器领奏（复古合成版的衬底是很轻的西班牙吉他扫弦与持续音）。旋律原创。
// F 大调五声（F G A C D），4/4（每分钟 104 拍）。马约瓦坎的低舌（F）与高舌（C）敲“三 + 三 + 二”（加勒比的 tresillo，
// 岛上的西班牙、非洲与泰诺在这里碰头），马拉卡一高一低地交替，刮瓜“长 — 短短”，木棍敲鼓身的“嗒”落在空处：
// - 引子：海螺号（泰诺人叫 guamo）吹两声，马拉卡与刮瓜先进来，木鼓接上；
// - A：骨笛领唱一句（两小节），两支陶笛（众人）接一句，一领一和两轮；再来时众人分高低两个八度齐唱（第二支陶笛低八度——
//   阿雷伊托的众人是齐唱，不分声部，不在下方三度配和声），吉他扫起来；
// - B：大家一起唱高一些的一句（第二遍是骨笛与低八度的陶笛），海螺号在下面拉长音；
// - 尾声海螺号一声，木鼓“三 + 三 + 二”收住。
// 和声只有空五度（F–C、C–G、降B–F）：泰诺人的歌没有西洋的三和弦，吉他也只扫空五度；骨笛与两支陶笛之间只有同度与八度（americas.test 逐音查旋律声部之间的三度、六度）。
import type { TrackDef } from "../score";

/** 马约瓦坎：三 + 三 + 二（低 · · 低 · · 高 ·），每两小节换一种填法。 */
const slit = (bars: number) => Array.from({ length: bars }, (_, i) => (i % 2 === 0 ? "F,3 F,3 C2" : "F,2 F, F,2 F, C C")).join(" | ");

export const PORT_CARIBBEAN: TrackDef = {
  id: "port_caribbean",
  title: { zh: "岛上的阿雷伊托", en: "Areíto of the Islands" },
  qpm: 104,
  meter: [4, 4],
  key: "F major",
  voices: {
    lead: { inst: "bone_flute", gain: 0.48, pan: -0.1, reverb: 0.32 },
    chorus: { inst: "ocarina", gain: 0.44, pan: 0.16, reverb: 0.34 },
    chorus2: { inst: "ocarina", gain: 0.36, pan: 0.28, reverb: 0.36 },
    conch: { inst: "conch", gain: 0.34, pan: -0.06, reverb: 0.5 },
    slit: { inst: "mayohuacan", gain: 0.42, pan: 0.2, reverb: 0.26 },
    rim: { inst: "perc", gain: 0.22, pan: 0.26, reverb: 0.22, pattern: { kind: "drum", steps: "..r...r.", hits: { r: ["mayo_rim", 0.5] } } },
    maracas: {
      inst: "perc",
      gain: 0.26,
      pan: -0.28,
      reverb: 0.2,
      pattern: {
        a: { kind: "drum", grid: 0.5, steps: "HlhlHlhlHlhlHlhl", hits: { H: ["maraca_hi", 0.6], h: ["maraca_hi", 0.36], l: ["maraca_lo", 0.4] } },
        intro: { kind: "drum", grid: 0.5, steps: `................${"HlhlHlhlHlhlHlhl".repeat(3)}`, hits: { H: ["maraca_hi", 0.55], h: ["maraca_hi", 0.34], l: ["maraca_lo", 0.38] } },
      },
    },
    guiro: {
      inst: "perc",
      gain: 0.24,
      pan: 0.34,
      reverb: 0.22,
      pattern: {
        a: { kind: "drum", steps: "L.ssL.ss", hits: { L: ["guiro_long", 0.55], s: ["guiro_short", 0.38] } },
        intro: { kind: "drum", steps: "................L.ssL.ssL.ssL.ss", hits: { L: ["guiro_long", 0.5], s: ["guiro_short", 0.34] } },
      },
    },
    // 衬底（合成）：西班牙吉他很轻地扫空五度、持续音
    guitar: { inst: "guitar", gain: 0.1, pan: 0.32, reverb: 0.22, pattern: { kind: "strum", low: 41, high: 65, steps: "D . . d . . D ." } },
    pad: { inst: "drone", gain: 0.12, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 53, high: 69, size: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "F5 | F5 | C5 | F5",
      lines: {
        call: "!bend!F,6 z2 | z8 | !bend!C6 z2 | !fall!F,6 z2",
        slit: `z8 | z8 | ${slit(2)}`,
      },
    },
    A: {
      bars: 8,
      chords: "F5 | C5 | F5 | C5 | F5 | F5 | F5 | F5",
      lines: {
        // 领唱（骨笛）一句、众人（陶笛）一句
        call: "c2 A c d2 c A | G2 A F G4 | z8 | z8 | d2 c d f2 d c | A2 G A F4 | z8 | z8",
        resp: "z8 | z8 | c2 A c A2 G F | G6 z2 | z8 | z8 | A2 G A c2 A G | F6 z2",
        slit: slit(8),
      },
    },
    B: {
      bars: 8,
      chords: "F5 | F5 | F5 | C5 | F5 | Bb5 | C5 | F5",
      lines: {
        bmel: "f2 f d c2 A2 | d2 c A G4 | A2 A c d2 f2 | !vib!g6 z2 | f2 d c A2 c2 | d2 c A G2 F2 | G2 A c A2 G2 | F6 z2",
        // 海螺号在下面拉长音
        horn: "!bend!F,8 | z8 | z8 | !bend!C8 | !bend!F,8 | z8 | !bend!C8 | !fall!F,8",
        slit: slit(8),
      },
    },
    coda: {
      bars: 2,
      chords: "F5 | F5",
      lines: { call: "!bend!F,8 | !fall!F,6 z2", slit: "F,3 F,3 C2 | F,2 z6" },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:conch slit:slit maracas.intro guiro.intro pad", dyn: 0.6, to: 0.66 },
      { s: "A", play: "call:lead resp:chorus slit:slit rim maracas.a guiro.a pad", dyn: 0.66 },
      { s: "A", play: "call:lead resp:chorus resp:chorus2-12 slit:slit rim maracas.a guiro.a guitar pad", dyn: 0.68 },
      { s: "B", play: "bmel:lead bmel:chorus horn:conch slit:slit rim maracas.a guiro.a guitar pad", dyn: 0.7 },
      { s: "A", play: "call:lead resp:chorus resp:chorus2-12 slit:slit rim maracas.a guiro.a guitar pad", dyn: 0.68, rit: 0.94 },
      { s: "coda", play: "call:conch slit:slit maracas.a pad", dyn: 0.66 },
    ],
    [
      { s: "A", play: "call:lead resp:chorus slit:slit rim maracas.a guiro.a pad", dyn: 0.64 },
      { s: "B", play: "bmel:lead bmel:chorus2-12 horn:conch slit:slit rim maracas.a guiro.a guitar pad", dyn: 0.68 },
      { s: "A", play: "call:lead resp:chorus resp:chorus2-12 slit:slit rim maracas.a guiro.a guitar pad", dyn: 0.7, rit: 0.94 },
      { s: "coda", play: "call:conch slit:slit maracas.a pad", dyn: 0.66 },
    ],
  ],
  rest: [10, 18],
  level: 1.32,
};
