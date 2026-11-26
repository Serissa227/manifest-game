// 《擂台上的旗》管弦版（养成篇的比赛，C 大调 4/4，昂扬、年轻）：旋律与和声同合成版，按管弦乐重新配器。
// 开头小号把成长动机吹成号角，定音鼓滚奏、军鼓滚奏推上去；A 段第一小提琴唱主题，大提琴组跳弓不停地拉八分音符，低音提琴一小节一个长音，
// 军鼓轻快地推着；再来时小号领、圆号吹长音的对位；B 段第一小提琴与低八度的圆号往上爬（第二遍小号领），第二小提琴与中提琴的和弦；
// 最后全奏：小号、第一小提琴与高八度的长笛齐奏主题，长号的和弦托底，一记对击钹。
import type { TrackDef } from "../../score";
import { UB_CONTEST as SYNTH } from "../../tracks/ubContest";
import { bass, chords, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const UB_CONTEST: TrackDef = {
  id: "ub_contest",
  title: SYNTH.title,
  qpm: 132,
  meter: [4, 4],
  key: "C major",
  level: 0.8,
  voices: {
    tp: line("o.tp", 0.46, SEAT.tp, WET.brass),
    vn1: line("o.vn", 0.54, SEAT.vn1, WET.strings),
    hn: line("o.hn", 0.44, SEAT.hn, WET.brass),
    fl: line("o.fl", 0.36, SEAT.fl, WET.winds),
    ost: pulse("o.vc.spic", 0.36, SEAT.vc, 0.22, { kind: "arp", low: 36, steps: "1 1 5 1 8 1 5 1" }),
    cb: line("o.cb", 0.22, SEAT.cb, 0.2, bass("1 . . . . . . .", 28)),
    vn2: chords("o.vn", 0.13, SEAT.vn2, WET.strings, 62, 74, 2),
    va: chords("o.va", 0.13, SEAT.va, WET.strings, 55, 67, 2),
    tb: chords("o.tb", 0.13, SEAT.tb, WET.brass, 45, 60, 3),
    timp: line("o.timp", 0.4, SEAT.timp, 0.3),
    snare: pulse("o.perc", 0.3, -0.12, 0.22, {
      a: { kind: "drum", steps: "X.x.X.xx", hits: { X: ["snare", 0.42], x: ["snare", 0.22] } },
      b: { kind: "drum", steps: "X.x.X.x.X.x.Xxxx", hits: { X: ["snare", 0.46], x: ["snare", 0.24] } },
    }),
    perc: line("o.perc", 0.28, 0.2, 0.36),
  },
  sections: {
    intro: { ...S.intro, lines: { call: S.intro.lines!.call, timp: S.intro.lines!.timp, roll: "z8 | z4 =E4 | z8 | z8" } },
    A: { ...S.A, lines: { ...S.A.lines!, crash: "=F8 | z8 | z8 | z8 | z8 | z8 | z8 | z8" } },
    B: { ...S.B },
    outro: { ...S.outro, lines: { tag: S.outro.lines!.tag, timp: S.outro.lines!.timp, crash: "z8 | =F8" } },
  },
  forms: [
    [
      { s: "intro", play: "call:tp timp:timp roll:perc va vn2", dyn: 0.66, to: 0.74 },
      { s: "A", play: "mel:vn1 ost cb va snare", dyn: 0.72 },
      { s: "A", play: "mel:tp mel:vn1 hcnt:hn ost cb vn2 va snare timp:timp", dyn: 0.76 },
      { s: "B", play: "bmel:vn1 bmel:hn-12 ost cb vn2 va snare timp:timp", dyn: 0.74, to: 0.8 },
      { s: "A", play: "mel:tp mel:vn1 mel:fl+12 hcnt:hn crash:perc ost cb tb vn2 va snare.b timp:timp", dyn: 0.82 },
      { s: "outro", play: "tag:tp tag:vn1 crash:perc cb tb vn2 va timp:timp", dyn: 0.82, to: 0.7, rit: 0.8 },
    ],
    [
      { s: "intro", play: "call:tp timp:timp va", dyn: 0.64, to: 0.72 },
      { s: "A", play: "mel:tp ost cb va snare", dyn: 0.72 },
      { s: "B", play: "bmel:vn1 ost cb vn2 va snare timp:timp", dyn: 0.72, to: 0.78 },
      { s: "B", play: "bmel:tp bmel:hn-12 ost cb vn2 va snare timp:timp", dyn: 0.76, to: 0.8 },
      { s: "A", play: "mel:tp mel:vn1 mel:fl+12 hcnt:hn crash:perc ost cb tb vn2 va snare.b timp:timp", dyn: 0.82 },
      { s: "outro", play: "tag:tp tag:vn1 crash:perc cb tb vn2 va timp:timp", dyn: 0.82, to: 0.7, rit: 0.8 },
    ],
  ],
  rest: [4, 8],
};
