// 《烈风》：海上的暴风雨（第二首，与《怒涛》轮着放——那一首是 6/8 的翻滚的浪，这一首是 4/4 的一阵紧过一阵的风）。
// 第九批 A01（2026-11-11）新写，旋律原创。G 小调，4/4 拍（每分钟 138 拍），紧、急，但不是海战：
// - 大提琴组一刻不停地拉八分音符的分解和弦（根音 – 五度 – 八度 – 五度 – 三度……，跟着和弦走），是横着扫过来的风；
// - 弦乐群与人声“呜——”托在后面，定音鼓在 G 与 D 上重击、滚奏，军鼓碎着，低沉的大鼓两小节一下；
// - A：小提琴组在高处拉一条焦急的线（G 小 → 降 E → D 大三和弦的升 F，最后顺着属七和弦一路爬上去）；
// - B：圆号与小号吹一段硬撑着的号角（降 B → F → G 小 → D），小提琴高八度齐奏；
// 一遍奏完只歇几秒就再来；天气好了回到原来的航海曲。
import type { TrackDef } from "../score";

export const STORM_GALE: TrackDef = {
  id: "storm_gale",
  title: { zh: "烈风" },
  qpm: 138,
  meter: [4, 4],
  key: "G minor",
  level: 0.84,
  hall: true,
  voices: {
    ost: { inst: "celli", gain: 0.46, pan: 0.15, reverb: 0.28, pattern: { kind: "arp", low: 43, steps: "1 5 8 5 10 5 8 5" } },
    violins: { inst: "violins", gain: 0.52, pan: -0.25, reverb: 0.34 },
    horns: { inst: "horns", gain: 0.52, pan: 0.28, reverb: 0.4 },
    tpt: { inst: "trumpet", gain: 0.4, pan: 0.18, reverb: 0.38 },
    strings: { inst: "strings", gain: 0.36, pan: -0.1, reverb: 0.4, pattern: { kind: "pad", low: 50, high: 67, size: 3 } },
    choir: { inst: "choir", gain: 0.28, pan: 0.2, reverb: 0.6, pattern: { kind: "pad", low: 57, high: 74, size: 3 } },
    timp: { inst: "timpani", gain: 0.42, reverb: 0.3 },
    snare: { inst: "perc", gain: 0.34, pan: -0.15, reverb: 0.25, pattern: { kind: "drum", steps: "..s...ss", hits: { s: ["snare", 0.34] } } },
    boom: { inst: "perc", gain: 0.2, pan: 0.05, reverb: 0.35, pattern: { kind: "drum", steps: "T.......T...t...", hits: { T: ["taiko", 0.7], t: ["taiko", 0.35] } } },
    cymbal: { inst: "perc", gain: 0.1, pan: 0.3, reverb: 0.4, pattern: { kind: "drum", steps: "C" + ".".repeat(63), hits: { C: ["cymbal", 0.7] } } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "Gm | Gm",
      lines: { timp: "!trem!G,,8- | G,,8" },
    },
    A: {
      bars: 8,
      chords: "Gm | Gm | Eb | D | Gm | Cm | D | D",
      lines: {
        mel: "d4 g3 f | d2 c2 B2 G2 | e4 g3 e | ^f6 d2 | g4 b3 a | g2 e2 c2 e2 | d2 ^f2 a2 c'2 | d'8",
        timp: "!accent!G,,2 z6 | z8 | z8 | !trem!D,8 | !accent!G,,2 z6 | z8 | z8 | !trem!D,8",
      },
    },
    B: {
      bars: 8,
      chords: "Bb | F | Gm | D | Eb | Bb | Cm | D",
      lines: {
        // 号角
        hmel: "B4 d3 f | f4 c4 | d4 B3 d | A6 ^F2 | G4 B3 e | d4 B4 | c4 e3 d | d8",
        timp: "!accent!B,,2 z6 | z8 | !accent!G,,2 z6 | !trem!D,8 | z8 | !accent!B,,2 z6 | z8 | !trem!D,8",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "ost timp:timp strings", dyn: 0.62, to: 0.72 },
      { s: "A", play: "ost strings timp:timp snare boom", dyn: 0.72 },
      { s: "A", play: "ost mel:violins strings choir timp:timp snare boom", dyn: 0.76 },
      { s: "B", play: "ost hmel:horns hmel:tpt strings choir timp:timp snare boom cymbal", dyn: 0.8 },
      { s: "A", play: "ost mel:violins mel:horns-12 strings choir timp:timp snare boom", dyn: 0.8 },
      { s: "B", play: "ost hmel:horns hmel:tpt hmel:violins+12 strings choir timp:timp snare boom cymbal", dyn: 0.84 },
    ],
    [
      { s: "intro", play: "ost timp:timp", dyn: 0.62, to: 0.7 },
      { s: "A", play: "ost mel:violins strings timp:timp snare boom", dyn: 0.74 },
      { s: "B", play: "ost hmel:horns strings choir timp:timp snare boom", dyn: 0.78 },
      { s: "A", play: "ost mel:violins mel:horns-12 strings choir timp:timp snare boom", dyn: 0.8 },
      { s: "B", play: "ost hmel:horns hmel:tpt hmel:violins+12 strings choir timp:timp snare boom cymbal", dyn: 0.84 },
      { s: "A", play: "ost mel:violins mel:tpt-12 strings choir timp:timp snare boom", dyn: 0.8 },
    ],
  ],
  rest: [3, 6],
};
