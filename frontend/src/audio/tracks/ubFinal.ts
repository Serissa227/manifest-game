// 《决胜局》：养成篇的情境音乐——比赛（比赛日、比赛的小游戏与比赛事件，与《擂台上的旗》轮着放）。最后一局，看台上的人都站起来了。旋律原创。
// 第九批 A01（2026-11-11）新写。F 大调，6/8 拍（每分钟 144 个四分音符，附点四分音符一拍 96：跑起来的步子），亮、快：
// - 大提琴组一刻不停地拉分解和弦，军鼓敲“哒 · 哒哒 · 哒”的跑步节奏，定音鼓在 F 与 C 上重击、滚奏；
// - A：小号吹主题（同音起跳、一路往上冲到高音 C）；A′：小提琴组接过去冲得更高，圆号低八度跟着，落在主音上；
// - B：转到 D 小调一侧，长笛与竖笛（管弦版是单簧管）隔着八度吹一段轻一点的句子（对手也不弱），借 A 大三和弦的升 C 回来；
// - 尾声全体收在主和弦上，定音鼓最后一击。
// 一遍奏完只歇几秒就再来。管弦版：小号、圆号、小提琴、长笛、单簧管，大提琴的跳弓，小提琴组的颤弓与长号的和弦，定音鼓、军鼓、大鼓、钹。
import type { TrackDef } from "../score";

export const UB_FINAL: TrackDef = {
  id: "ub_final",
  title: { zh: "决胜局" },
  qpm: 144,
  meter: [6, 8],
  key: "F major",
  level: 0.79,
  voices: {
    tpt: { inst: "trumpet", gain: 0.48, pan: 0.2, reverb: 0.36 },
    horns: { inst: "horns", gain: 0.48, pan: -0.24, reverb: 0.4 },
    violins: { inst: "violins", gain: 0.5, pan: -0.26, reverb: 0.34 },
    fl: { inst: "flute", gain: 0.42, pan: -0.06, reverb: 0.34 },
    cl: { inst: "recorder", gain: 0.4, pan: 0.12, reverb: 0.32 },
    ost: { inst: "celli", gain: 0.42, pan: 0.16, reverb: 0.26, pattern: { kind: "arp", low: 41, steps: "1 5 8 5 3 5" } },
    strings: { inst: "strings", gain: 0.3, pan: -0.08, reverb: 0.38, pattern: { kind: "pad", low: 53, high: 70, size: 3 } },
    timp: { inst: "timpani", gain: 0.4, reverb: 0.3 },
    snare: { inst: "perc", gain: 0.34, pan: -0.14, reverb: 0.24, pattern: { kind: "drum", steps: "s.ss.s", hits: { s: ["snare", 0.32] } } },
    boom: { inst: "perc", gain: 0.2, pan: 0.05, reverb: 0.34, pattern: { kind: "drum", steps: "T..t..", hits: { T: ["taiko", 0.62], t: ["taiko", 0.32] } } },
    cymbal: { inst: "perc", gain: 0.1, pan: 0.3, reverb: 0.4, pattern: { kind: "drum", steps: "C" + ".".repeat(47), hits: { C: ["cymbal", 0.7] } } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "F | C",
      lines: { timp: "!trem!C,6- | C,6" },
    },
    A: {
      bars: 8,
      chords: "F | F | Bb | C | F | Dm | C | C",
      lines: {
        mel: "c2 c f2 a | c'3 a2 f | d2 d f2 b | g3 e3 | c2 c f2 a | a3 f2 d | e2 g c'2 g | g6",
        timp: "!accent!F,,2 z F,,2 z | z6 | z6 | !trem!C,6 | !accent!F,,2 z F,,2 z | z6 | !trem!C,6- | C,6",
      },
    },
    A2: {
      bars: 8,
      chords: "F | Am | Bb | C | Dm | Bb | C | F",
      lines: {
        mel2: "a2 f c'2 a | e'3 c'2 a | d'2 b f2 b | c'3 g3 | a2 f d2 f | b2 d' b2 f | e2 g c'2 e' | f'6",
        timp: "!accent!F,,2 z4 | z6 | !accent!B,,2 z4 | !trem!C,6 | !accent!D,2 z4 | !accent!B,,2 z4 | !trem!C,6 | !accent!F,,2 z4",
      },
    },
    B: {
      bars: 8,
      chords: "Dm | Dm | Gm | A | Dm | Bb | Gm*3 C*3 | C",
      lines: {
        bmel: "d2 f a2 f | d'3 a3 | b2 g d2 g | ^c'3 a2 e | f2 a d'2 a | b3 f2 d | g2 b c'2 e | g6",
        timp: "!accent!D,2 z4 | z6 | !accent!G,,2 z4 | !trem!A,,6 | !accent!D,2 z4 | !accent!B,,2 z4 | z6 | !trem!C,6",
      },
    },
    coda: {
      bars: 4,
      chords: "Bb | C | F | F",
      lines: {
        end: "d2 d f2 b | g2 g c'2 e | f6 | f3 z3",
        timp: "!accent!B,,2 z4 | !trem!C,6 | !accent!F,,2 z F,,2 z | !accent!F,,3 z3",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "ost timp:timp snare", dyn: 0.66, to: 0.74 },
      { s: "A", play: "mel:tpt ost strings timp:timp snare boom", dyn: 0.74 },
      { s: "A2", play: "mel2:violins mel2:horns-12 ost strings timp:timp snare boom cymbal", dyn: 0.78 },
      { s: "B", play: "bmel:fl bmel:cl-12 ost strings timp:timp snare", dyn: 0.7, to: 0.76 },
      { s: "A", play: "mel:tpt mel:horns-12 ost strings timp:timp snare boom", dyn: 0.8 },
      { s: "A2", play: "mel2:violins mel2:horns-12 mel2:tpt-12 ost strings timp:timp snare boom cymbal", dyn: 0.84 },
      { s: "B", play: "bmel:fl bmel:cl-12 bmel:violins ost strings timp:timp snare boom", dyn: 0.76, to: 0.82 },
      { s: "coda", play: "end:tpt end:horns-12 end:violins ost strings timp:timp snare boom", dyn: 0.84 },
    ],
    [
      { s: "intro", play: "ost timp:timp snare", dyn: 0.66, to: 0.74 },
      { s: "A", play: "mel:horns-12 ost strings timp:timp snare boom", dyn: 0.72 },
      { s: "B", play: "bmel:fl bmel:cl-12 ost strings timp:timp snare", dyn: 0.7, to: 0.76 },
      { s: "A2", play: "mel2:violins mel2:horns-12 ost strings timp:timp snare boom cymbal", dyn: 0.8 },
      { s: "B", play: "bmel:violins bmel:cl-12 ost strings timp:timp snare boom", dyn: 0.76, to: 0.8 },
      { s: "A", play: "mel:tpt mel:horns-12 ost strings timp:timp snare boom", dyn: 0.8 },
      { s: "A2", play: "mel2:violins mel2:horns-12 mel2:tpt-12 ost strings timp:timp snare boom cymbal", dyn: 0.84 },
      { s: "coda", play: "end:tpt end:horns-12 end:violins ost strings timp:timp snare boom", dyn: 0.84 },
    ],
  ],
  rest: [4, 8],
};
