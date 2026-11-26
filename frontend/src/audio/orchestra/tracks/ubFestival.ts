// 《节日的街》管弦版（养成篇的节日，D 大调 3/4 的加利亚德快舞，句尾两小节赫米奥拉）：旋律与和声同合成版，按管弦乐重新配器。
// 小号在街口吹两声，铃鼓与大鼓起来，大提琴组的 D–A 空五度长音代替风笛的持续音；
// A 段第一小提琴领跳（跳弓的颗粒），再来时长笛同奏、第三遍长笛高八度；竖琴与小提琴组的拨奏在第二、三拍“嚓 嚓”；
// B 段游行：小号吹号角式的旋律，圆号低八度跟着，第二小提琴与中提琴的和弦长音、军鼓轻轻滚着；尾声一齐落在主和弦上，一记对击钹。
import type { TrackDef } from "../../score";
import { UB_FESTIVAL as SYNTH } from "../../tracks/ubFestival";
import { bass, chords, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const UB_FESTIVAL: TrackDef = {
  id: "ub_festival",
  title: SYNTH.title,
  qpm: 168,
  meter: [3, 4],
  key: "D major",
  level: 0.95,
  voices: {
    vn1: line("o.vn", 0.54, SEAT.vn1, WET.strings),
    spic: line("o.vn.spic", 0.3, SEAT.vn1 + 0.08, WET.strings),
    fl: line("o.fl", 0.42, SEAT.fl, WET.winds),
    tp: line("o.tp", 0.46, SEAT.tp, WET.brass),
    hn: line("o.hn", 0.4, SEAT.hn, WET.brass),
    vnp: pulse("o.vn.pizz", 0.26, SEAT.vn2, WET.strings, bass("- - 8+10 - 8+10 -", 55)),
    harp: pulse("o.harp", 0.22, SEAT.harp, WET.harp, { kind: "arp", low: 50, steps: "1 5 8 5 10 5", ring: 2 }),
    vcp: pulse("o.vc.pizz", 0.36, SEAT.vc, WET.low, bass("1 . . . 5, .", 41, 2)),
    cbp: pulse("o.cb.pizz", 0.26, SEAT.cb, WET.low, bass("1 . . . . .", 26, 2)),
    drone: { inst: "o.vc", gain: 0.13, pan: SEAT.vc, reverb: 0.26, poly: true, pattern: { kind: "drone", notes: [38, 45] } },
    vn2: chords("o.vn", 0.12, SEAT.vn2, WET.strings, 62, 74, 2),
    va: chords("o.va", 0.12, SEAT.va, WET.strings, 55, 67, 2),
    perc: pulse("o.perc", 0.34, SEAT.perc, WET.perc, {
      a: { kind: "drum", steps: "B.t.t.", hits: { B: ["bd", 0.42], t: ["tamb", 0.3] } },
      b: { kind: "drum", steps: "B.s.s.B.s.ss", hits: { B: ["bd", 0.5], s: ["snare", 0.22] } },
    }),
    shake: pulse("o.perc", 0.24, 0.3, WET.perc, { kind: "drum", steps: "..s.s.", hits: { s: ["shake", 0.3] } }),
    crash: line("o.perc", 0.26, 0.3, 0.4),
  },
  sections: {
    intro: { ...S.intro },
    A: { ...S.A },
    B: { ...S.B },
    outro: { ...S.outro, lines: { tag: S.outro.lines!.tag, crash: "z6 | z6 | =F6 | z6" } },
  },
  forms: [
    [
      { s: "intro", play: "call:tp drone perc shake", dyn: 0.62, to: 0.7 },
      { s: "A", play: "mel:vn1 mel:spic harp vcp cbp drone perc shake", dyn: 0.7 },
      { s: "A", play: "mel2:vn1 mel2:fl vnp vcp cbp drone perc shake", dyn: 0.72 },
      { s: "B", play: "bm:tp bm:hn-12 vn2 va vcp cbp perc.b", dyn: 0.74 },
      { s: "A", play: "mel:vn1 mel:fl+12 harp vnp vcp cbp drone perc shake", dyn: 0.74 },
      { s: "A", play: "mel2:vn1 mel2:tp-12 vnp vn2 va vcp cbp perc shake", dyn: 0.76 },
      { s: "outro", play: "tag:vn1 tag:tp crash:crash vn2 va vcp cbp perc", dyn: 0.74, to: 0.6, rit: 0.9 },
    ],
    [
      { s: "intro", play: "call:tp perc", dyn: 0.6, to: 0.68 },
      { s: "A", play: "mel:fl harp vcp cbp drone perc shake", dyn: 0.68 },
      { s: "B", play: "bm:vn1 bm:hn-12 vnp va vcp cbp perc shake", dyn: 0.72 },
      { s: "B", play: "bm:tp bm:hn-12 vn2 va vcp cbp perc.b", dyn: 0.75 },
      { s: "A", play: "mel2:vn1 mel2:fl vnp vcp cbp drone perc shake", dyn: 0.74 },
      { s: "outro", play: "tag:vn1 tag:tp crash:crash vn2 va vcp cbp perc", dyn: 0.72, to: 0.58, rit: 0.9 },
    ],
  ],
  rest: [6, 12],
};
