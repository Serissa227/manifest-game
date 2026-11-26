// 《各自的帆》管弦版（养成篇的结业，D 大调慢 4/4，不舍又期待）：旋律与和声同合成版，按管弦乐重新配器。
// A 段单簧管唱主题（第二遍大提琴组，接着长笛高八度再唱一遍），竖琴的分解和弦、低音提琴的长音；B 段第一小提琴唱，第二小提琴与中提琴的和弦，末尾定音鼓在 A 上滚奏；
// 全奏的主题：第一小提琴与低八度的圆号齐奏，大提琴组拉对位，长号很轻的和弦托底；
// 尾声圆号吹起全作的起帆动机，长笛（第二遍第一小提琴）停在主音上，钟琴点亮最后的主和弦。用大厅混响。
import type { TrackDef } from "../../score";
import { UB_GRADUATION as SYNTH } from "../../tracks/ubGraduation";
import { chords, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const UB_GRADUATION: TrackDef = {
  id: "ub_graduation",
  title: SYNTH.title,
  qpm: 72,
  meter: [4, 4],
  key: "D major",
  hall: true,
  voices: {
    vn1: line("o.vn", 0.54, SEAT.vn1, WET.strings),
    fl: line("o.fl", 0.5, SEAT.fl, WET.winds),
    cl: line("o.cl", 0.48, SEAT.cl, WET.winds),
    hn: line("o.hn", 0.46, SEAT.hn, WET.brass),
    vc: line("o.vc", 0.5, SEAT.vc, WET.strings),
    glock: line("o.glock", 0.18, SEAT.glock, WET.bells),
    harp: pulse("o.harp", 0.3, SEAT.harp, WET.harp, {
      a: { kind: "arp", low: 43, steps: "1 5 8 10 12 10 8 5", ring: 2 },
      b: { kind: "arp", low: 43, steps: "1 . 8 . 10 . 12 .", ring: 3 },
    }),
    vn2: chords("o.vn", 0.13, SEAT.vn2, WET.strings, 62, 76, 2),
    va: chords("o.va", 0.13, SEAT.va, WET.strings, 55, 67, 3),
    tb: chords("o.tb", 0.1, SEAT.tb, WET.brass, 45, 60, 3),
    cb: chords("o.cb", 0.15, SEAT.cb, WET.low, 26, 38, 1),
    timp: line("o.timp", 0.34, SEAT.timp, 0.36),
  },
  sections: {
    intro: { ...S.intro },
    A: { ...S.A },
    A2: { ...S.A2 },
    B: { ...S.B },
    coda: { ...S.coda },
  },
  forms: [
    [
      { s: "intro", play: "harp.b cb", dyn: 0.5 },
      { s: "A", play: "mel:cl harp cb", dyn: 0.56 },
      { s: "B", play: "bmel:vn1 harp.b vn2 va cb timp:timp", dyn: 0.62, to: 0.7 },
      { s: "A2", play: "mel2:vn1 mel2:hn-12 cnt:vc harp vn2 va tb cb timp:timp", dyn: 0.72 },
      { s: "coda", play: "motif:hn fin:fl spark:glock harp.b va cb", dyn: 0.64, to: 0.46, rit: 0.8 },
    ],
    [
      { s: "intro", play: "harp.b", dyn: 0.48 },
      { s: "A", play: "mel:vc harp cb", dyn: 0.56 },
      { s: "A2", play: "mel2:fl+12 cnt:vc harp va cb", dyn: 0.6 },
      { s: "B", play: "bmel:vn1+12 bmel:fl harp.b vn2 va cb timp:timp", dyn: 0.64, to: 0.72 },
      { s: "A2", play: "mel2:vn1 mel2:hn-12 cnt:vc harp vn2 va tb cb timp:timp", dyn: 0.72 },
      { s: "coda", play: "motif:hn fin:vn1 spark:glock harp.b va cb", dyn: 0.62, to: 0.44, rit: 0.8 },
    ],
  ],
  rest: [10, 18],
};
