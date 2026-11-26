// 《尤卡坦的信风》：加勒比与中美（尤卡坦半岛、安的列斯群岛、伊斯帕尼奥拉，玛雅人的独木舟与西班牙人的帆船在同一片海上）。
// B 小调，6/8 拍（每分钟 120 拍），“六三交替”（sesquialtera）：一小节按 6/8 唱成两个附点四分，下一小节按 3/4 唱成三个四分——
// 木鼓、扫弦与沙槌都跟着两小节一换：一小节“咚 · · 嗒 · ·”，一小节“咚 · 嗒 · 嗒 ·”。
// 地方特色第二阶段·美洲重编（旋律、和声与曲式不变；以前是用圆号、吉他、竖笛与马林巴“模仿”地方乐器，现在由地方乐器领奏）：
// - 开头海螺号吹起全作的起帆动机（升 F → B → 升 F）；泰诺人的马约瓦坎木鼓（两片舌头：B 与升 F）与一对马拉卡一直响着，刮瓜跟着六三交替；
// - A 段泰诺骨笛领奏，再来时玛雅陶笛唱上面的一句、骨笛在低八度跟着；
// - B 段转到 D 大调一侧，信风吹起来：奇里米亚木管唱（修士带来的肖姆管，玛雅的乐师吹它），海螺号在下面拉和弦的根音，
//   最后停在升 F 大三和弦上；
// - 西班牙的颜色只留在衬底里：吉他很轻地扫、拨奏的低音、弦乐的长音。
// 与经典世界的《阿斯特里亚的海岸》（A 混合利底亚 6/8）、《伊比利亚》（安达卢西亚终止）都不同：这里是六三交替与木鼓、沙槌。
import type { TrackDef } from "../score";

/**
 * 裂缝木鼓：两个音高（B 与升 F），单数小节按 6/8（咚 · 咚 嗒 · 嗒）、双数小节按 3/4（咚 · 嗒 · 咚 ·）；
 * 升 F 大三和弦的小节换成升 F 与升 C（两块木舌的另一对音），免得 B 顶着升 A。
 */
const slit = (chords: string): string =>
  chords
    .split("|")
    .map((c, i) => {
      const fs = c.trim() === "F#";
      if (i % 2 === 0) return fs ? "F,,2 F,, C,2 C," : "B,,2 B,, F,,2 F,,";
      return fs ? "F,,2 C,2 F,,2" : "B,,2 F,,2 B,,2";
    })
    .join(" | ");

/** 马拉卡与刮瓜：两小节一换（6/8 的两个附点四分、3/4 的三个四分）。 */
const SESQUI = { maracas: "Hll Hll H.l.H.", guiro: "L..s.. L.s.L." } as const;

export const SEA_CARIBBEAN: TrackDef = {
  id: "sea_caribbean",
  title: { zh: "尤卡坦的信风", en: "Trade Winds of Yucatán" },
  qpm: 120,
  meter: [6, 8],
  key: "B minor",
  voices: {
    bone: { inst: "bone_flute", gain: 0.5, pan: -0.12, reverb: 0.3 },
    ocarina: { inst: "ocarina", gain: 0.46, pan: 0.14, reverb: 0.32 },
    chirimia: { inst: "chirimia", gain: 0.46, pan: -0.2, reverb: 0.34 },
    conch: { inst: "conch", gain: 0.36, pan: -0.3, reverb: 0.46 },
    slit: { inst: "mayohuacan", gain: 0.36, pan: 0.24, reverb: 0.26 },
    maracas: { inst: "perc", gain: 0.3, pan: -0.3, reverb: 0.2, pattern: { kind: "drum", steps: SESQUI.maracas.replace(/ /g, ""), hits: { H: ["maraca_hi", 0.5], l: ["maraca_lo", 0.3] } } },
    guiro: { inst: "perc", gain: 0.22, pan: 0.34, reverb: 0.2, pattern: { kind: "drum", steps: SESQUI.guiro.replace(/ /g, ""), hits: { L: ["guiro_long", 0.45], s: ["guiro_short", 0.3] } } },
    // 衬底（合成）：西班牙的吉他扫弦、拨奏的低音、弦乐的长音
    guitar: { inst: "guitar", gain: 0.08, pan: 0.32, reverb: 0.22, pattern: { kind: "strum", low: 40, high: 64, steps: "D . u D . u D . D . D ." } },
    bass: { inst: "pizz", gain: 0.17, pan: 0.05, reverb: 0.15, pattern: { kind: "arp", low: 35, steps: "1 . . 5, . . 1 . 5, . 8 .", ring: 2 } },
    strings: { inst: "strings", gain: 0.15, pan: -0.2, reverb: 0.4, pattern: { kind: "pad", low: 54, high: 71, size: 3 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "Bm | Bm | Bm | F#",
      lines: {
        // 海螺号：起帆动机（升 F → B → 升 F）
        motif: "z6 | z4 F,3/2 B,/2 | F6 | z6",
        slit: slit("Bm | Bm | Bm | F#"),
      },
    },
    A: {
      bars: 8,
      // 单数小节按 6/8，双数小节按 3/4
      chords: "Bm | A | G | F# | Bm | A | G*3 A*3 | Bm",
      lines: {
        mel: "f3 d B c | e2 c2 A2 | d3 B G A | ^A2 c2 f2 | f3 d B c | e2 a2 g2 | g2 f2 e2 | d3 B3",
        mel2: "f3 {g}f d c | e2 c2 A2 | d3 B G A | ^A2 c2 f2 | b3 a f d | e2 a2 g2 | g2 f2 e2 | f3 B3",
        slit: slit("Bm | A | G | F# | Bm | A | G | Bm"),
      },
    },
    B: {
      bars: 8,
      chords: "D | A | Bm | G | D | A | G | F#",
      lines: {
        bmel: "a3 f3 | e2 c2 e2 | d3 B3 | B2 d2 g2 | a3 f d e | c2 e2 a2 | b3 g3 | ^a6",
        // 海螺号在下面拉和弦的根音
        roots: "!bend!D,6 | A,,6 | !bend!B,,6 | G,,6 | !bend!D,6 | A,,6 | G,,6 | !fall!F,,6",
        slit: slit("D | A | Bm | G | D | A | G | F#"),
      },
    },
    outro: {
      bars: 4,
      chords: "G | F# | Bm | Bm",
      lines: { tag: "g3 e3 | ^A2 c2 f2 | B6 | z6", slit: slit("G | F# | Bm | Bm") },
    },
  },
  forms: [
    [
      { s: "intro", play: "motif:conch slit:slit maracas", dyn: 0.55, to: 0.64 },
      { s: "A", play: "mel:bone guitar bass slit:slit maracas guiro", dyn: 0.66 },
      { s: "A", play: "mel2:ocarina mel:bone-12 guitar bass slit:slit maracas guiro", dyn: 0.68 },
      { s: "B", play: "bmel:chirimia roots:conch strings guitar bass slit:slit maracas guiro", dyn: 0.7, to: 0.74 },
      { s: "A", play: "mel2:ocarina mel2:chirimia-12 guitar strings bass slit:slit maracas guiro", dyn: 0.74 },
      { s: "outro", play: "tag:bone guitar bass slit:slit", dyn: 0.62, to: 0.42, rit: 0.85 },
    ],
    [
      { s: "intro", play: "motif:conch slit:slit", dyn: 0.52, to: 0.62 },
      { s: "A", play: "mel:ocarina guitar bass slit:slit maracas", dyn: 0.64 },
      { s: "B", play: "bmel:bone guitar bass slit:slit maracas guiro", dyn: 0.68 },
      { s: "B", play: "bmel:chirimia roots:conch strings guitar bass slit:slit maracas guiro", dyn: 0.72, to: 0.76 },
      { s: "A", play: "mel2:ocarina mel2:chirimia-12 guitar strings bass slit:slit maracas guiro", dyn: 0.74 },
      { s: "outro", play: "tag:ocarina guitar bass slit:slit", dyn: 0.6, to: 0.4, rit: 0.85 },
    ],
  ],
  rest: [25, 45],
  level: 1.31,
};
