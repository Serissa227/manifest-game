// 《舷炮》：海战（第二首，与《黑帆》轮着放——那一首是 6/8 的追逐，这一首是 4/4 的并舷对轰）。
// 第九批 A01（2026-11-11）新写，旋律原创。E 小调，4/4 拍（每分钟 152 拍），硬、齐、一下一下往前压：
// - 大提琴组不停地拉八分音符的固定音型（根音两下 – 五度 – 根音 – 三度……），军鼓敲行进的节奏，大鼓压在每小节的两个强拍上；
// - A：小号吹号角一样的主题（同音三连击再往上跳：点火、开炮），B 大三和弦的升 D 把每一句推回主音；再来时圆号低八度跟着；
// - B：转到 G 大调一侧，小提琴组拉一条宽的旋律（船身横过来的那一下），圆号在下面走长音的对旋律，句尾悬在属和弦的导音上；
// 没有留白，一遍接一遍，直到战斗结束。
import type { TrackDef } from "../score";

export const BATTLE_BROADSIDE: TrackDef = {
  id: "battle_broadside",
  title: { zh: "舷炮" },
  qpm: 152,
  meter: [4, 4],
  key: "E minor",
  level: 0.75,
  voices: {
    ost: { inst: "celli", gain: 0.46, pan: 0.16, reverb: 0.26, pattern: { kind: "arp", low: 40, steps: "1 1 5 1 3 1 5 1" } },
    tpt: { inst: "trumpet", gain: 0.5, pan: 0.2, reverb: 0.36 },
    horns: { inst: "horns", gain: 0.5, pan: -0.24, reverb: 0.4 },
    violins: { inst: "violins", gain: 0.52, pan: -0.26, reverb: 0.34 },
    strings: { inst: "strings", gain: 0.34, pan: -0.08, reverb: 0.38, pattern: { kind: "pad", low: 52, high: 69, size: 3 } },
    timp: { inst: "timpani", gain: 0.42, reverb: 0.3 },
    snare: { inst: "perc", gain: 0.36, pan: -0.14, reverb: 0.24, pattern: { kind: "drum", steps: "s.sss.ss", hits: { s: ["snare", 0.34] } } },
    boom: { inst: "perc", gain: 0.22, pan: 0.05, reverb: 0.34, pattern: { kind: "drum", steps: "T...T...", hits: { T: ["taiko", 0.66] } } },
    cymbal: { inst: "perc", gain: 0.1, pan: 0.3, reverb: 0.4, pattern: { kind: "drum", steps: "C" + ".".repeat(63), hits: { C: ["cymbal", 0.7] } } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "Em | B",
      lines: { timp: "!accent!E,,2 z2 E,,2 z2 | !trem!B,,8" },
    },
    A: {
      bars: 8,
      chords: "Em | Em | C | B | Em | Am | B | B",
      lines: {
        // 号角：同音三连击再往上跳
        tmel: "E2 E E G2 B2 | e4 B4 | c2 c c e2 g2 | f4 ^d4 | e2 e e g2 e2 | c2 c c e2 a2 | b2 a g f2 ^d2 | B8",
        timp: "!accent!E,,2 z2 E,,2 z2 | z8 | !accent!C,2 z6 | !trem!B,,8 | !accent!E,,2 z2 E,,2 z2 | z8 | !trem!B,,8- | B,,8",
      },
    },
    B: {
      bars: 8,
      chords: "G | D | Em | B | C | G | Am | B",
      lines: {
        smel: "d4 g3 b | a4 f3 d | g4 e3 g | f6 ^d2 | e4 g3 c' | b4 g3 d | c4 e3 a | b6 ^d2",
        // 圆号的对旋律
        hcnt: "B,4 D4 | A,4 D4 | B,4 E4 | B,4 ^D4 | C4 E4 | D4 G4 | E4 C4 | ^D8",
        timp: "!accent!G,,2 z6 | !accent!D,2 z6 | !accent!E,,2 z6 | !trem!B,,8 | !accent!C,2 z6 | !accent!G,,2 z6 | !accent!A,,2 z6 | !trem!B,,8",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "ost timp:timp snare", dyn: 0.7, to: 0.78 },
      { s: "A", play: "ost tmel:tpt strings timp:timp snare boom", dyn: 0.78 },
      { s: "A", play: "ost tmel:tpt tmel:horns-12 strings timp:timp snare boom cymbal", dyn: 0.82 },
      { s: "B", play: "ost smel:violins hcnt:horns strings timp:timp snare boom", dyn: 0.8, to: 0.84 },
      { s: "A", play: "ost tmel:tpt tmel:horns-12 tmel:violins strings timp:timp snare boom cymbal", dyn: 0.86 },
      { s: "B", play: "ost smel:violins smel:tpt-12 hcnt:horns strings timp:timp snare boom", dyn: 0.84, to: 0.88 },
    ],
    [
      { s: "intro", play: "ost timp:timp snare", dyn: 0.7, to: 0.78 },
      { s: "A", play: "ost tmel:horns-12 strings timp:timp snare boom", dyn: 0.78 },
      { s: "B", play: "ost smel:violins strings timp:timp snare boom", dyn: 0.8 },
      { s: "A", play: "ost tmel:tpt tmel:horns-12 strings timp:timp snare boom cymbal", dyn: 0.84 },
      { s: "B", play: "ost smel:violins smel:tpt-12 hcnt:horns strings timp:timp snare boom", dyn: 0.84, to: 0.88 },
      { s: "A", play: "ost tmel:tpt tmel:horns-12 tmel:violins strings timp:timp snare boom cymbal", dyn: 0.86 },
    ],
  ],
  rest: [0, 0],
};
