// 《怒涛》管弦版（海上的暴风雨，C 小调 6/8，紧张、翻滚，但不是海战）：旋律与和声同合成版，按管弦乐重新配器。
// 大提琴组用跳弓不停地拉那个翻滚的八分音符固定音型，低音提琴每小节一个长音；小提琴组的颤弓和弦是呼啸的风；
// A 段第一小提琴在高处拉那条焦急的线，中提琴低八度跟着；B 段小号与圆号吹出变成小调的号角（第二次小提琴高八度齐奏），
// 长号的和弦托在下面，经过降 D 大三和弦（那不勒斯和弦）推到属和弦；定音鼓在 G 与 C 上滚奏、浪头砸下来时重击，
// 军鼓在第三、六拍，大鼓两小节一下，对击钹四小节一下。定音鼓按乐队的调法写在 G2 与 C3 上（合成版的 C2 低于采样的音域）。
import type { TrackDef } from "../../score";
import { STORM as SYNTH } from "../../tracks/storm";
import { bass, chords, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const STORM: TrackDef = {
  id: "storm",
  title: SYNTH.title,
  qpm: 126,
  meter: [6, 8],
  key: "C minor",
  hall: true,
  level: 0.8,
  voices: {
    ost: line("o.vc.spic", 0.5, SEAT.vc, 0.24),
    cb: line("o.cb", 0.26, SEAT.cb, 0.2, bass("1 . . . . .", 26)),
    trem: chords("o.vn.trem", 0.13, SEAT.vn2, 0.38, 60, 76, 3),
    vn1: line("o.vn", 0.56, SEAT.vn1, 0.32),
    va: line("o.va", 0.3, SEAT.va, 0.3),
    tp: line("o.tp", 0.42, SEAT.tp, WET.brass),
    hn: line("o.hn", 0.4, SEAT.hn, WET.brass),
    tb: chords("o.tb", 0.15, SEAT.tb, WET.brass, 45, 60, 3),
    timp: line("o.timp", 0.42, SEAT.timp, 0.3),
    snare: pulse("o.perc", 0.28, -0.15, 0.25, { kind: "drum", steps: "..s..s", hits: { s: ["snare", 0.34] } }),
    boom: pulse("o.perc", 0.34, 0.05, 0.35, { kind: "drum", steps: "T.....T..t..", hits: { T: ["bd", 0.6], t: ["bd", 0.32] } }),
    cymbal: pulse("o.perc", 0.24, 0.3, 0.4, { kind: "drum", steps: "C" + ".".repeat(47), hits: { C: ["crash", 0.62] } }),
  },
  sections: {
    intro: { ...S.intro, lines: { ost: S.intro.lines!.ost, timp: "!trem!C,6- | C,6" } },
    A: {
      ...S.A,
      lines: {
        ost: S.A.lines!.ost,
        mel: S.A.lines!.mel,
        timp: "z6 | z6 | z6 | !trem!G,,6 | !accent!C,2 z4 | z6 | z6 | !trem!G,,6",
      },
    },
    B: {
      ...S.B,
      lines: {
        ost: S.B.lines!.ost,
        hmel: S.B.lines!.hmel,
        timp: "!accent!F,,2 z4 | C,2 z4 | z6 | !trem!E,,6 | !accent!F,,2 z4 | C,2 z4 | z6 | !trem!G,,6",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "ost:ost cb timp:timp trem", dyn: 0.62, to: 0.72 },
      { s: "A", play: "ost:ost cb trem timp:timp snare boom", dyn: 0.72 },
      { s: "A", play: "ost:ost mel:vn1 mel:va-12 cb trem timp:timp snare boom", dyn: 0.76 },
      { s: "B", play: "ost:ost hmel:tp hmel:hn hmel:vn1+12 cb trem tb timp:timp snare boom cymbal", dyn: 0.82 },
      { s: "A", play: "ost:ost mel:vn1 mel:va-12 mel:hn-12 cb trem tb timp:timp snare boom", dyn: 0.8 },
    ],
    [
      { s: "intro", play: "ost:ost cb timp:timp", dyn: 0.62, to: 0.7 },
      { s: "A", play: "ost:ost mel:vn1 cb trem timp:timp snare boom", dyn: 0.74 },
      { s: "B", play: "ost:ost hmel:tp hmel:hn cb trem tb timp:timp snare boom", dyn: 0.78 },
      { s: "B", play: "ost:ost hmel:tp hmel:hn hmel:vn1+12 cb trem tb timp:timp snare boom cymbal", dyn: 0.82 },
      { s: "A", play: "ost:ost mel:vn1 mel:va-12 mel:hn-12 cb trem tb timp:timp snare boom", dyn: 0.8 },
    ],
  ],
  rest: [3, 6],
};
