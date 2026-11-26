// 《远方的来信》管弦版（养成篇的远方来信，E 小调 6/8 的船歌，怀念）：旋律与和声同合成版，按管弦乐重新配器。
// 竖琴一上一下的分解和弦是海面，远处的圆号（声像偏左、混响多）吹起帆动机；A 段单簧管唱主题（第二遍大提琴组），
// B 段长笛唱 G 大调一侧的回忆，第二小提琴与中提琴的和弦长音铺开；再唱 A 段时第一小提琴与低八度的大提琴组同奏；尾声停在 E 大三和弦上。
import type { TrackDef } from "../../score";
import { UB_LETTER as SYNTH } from "../../tracks/ubLetter";
import { chords, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const UB_LETTER: TrackDef = {
  id: "ub_letter",
  title: SYNTH.title,
  qpm: 72,
  meter: [6, 8],
  key: "E minor",
  level: 1.12,
  voices: {
    cl: line("o.cl", 0.5, SEAT.cl, 0.38),
    fl: line("o.fl", 0.48, SEAT.fl, 0.38),
    vn1: line("o.vn", 0.5, SEAT.vn1, 0.38),
    vc: line("o.vc", 0.48, SEAT.vc, 0.34),
    hn: line("o.hn", 0.38, SEAT.hn - 0.1, 0.55),
    harp: pulse("o.harp", 0.3, SEAT.harp, WET.harp, {
      a: { kind: "arp", low: 40, steps: "1 5 8 10 8 5", ring: 2 },
      b: { kind: "arp", low: 40, steps: "1 . 8 . 10 .", ring: 3 },
    }),
    vn2: chords("o.vn", 0.11, SEAT.vn2, 0.42, 64, 76, 2),
    va: chords("o.va", 0.12, SEAT.va, 0.4, 55, 67, 3),
    cb: chords("o.cb", 0.14, SEAT.cb, WET.low, 28, 40, 1),
  },
  sections: {
    intro: { ...S.intro },
    A: { ...S.A },
    B: { ...S.B },
    outro: { ...S.outro },
  },
  forms: [
    [
      { s: "intro", play: "call:hn harp cb", dyn: 0.5, to: 0.56 },
      { s: "A", play: "mel:cl harp cb", dyn: 0.58 },
      { s: "B", play: "bmel:fl harp vn2 va cb", dyn: 0.6, to: 0.64 },
      { s: "A", play: "mel:vn1 mel:vc-12 harp va cb", dyn: 0.62 },
      { s: "outro", play: "tag:cl call:hn harp.b va cb", dyn: 0.52, to: 0.36, rit: 0.85 },
    ],
    [
      { s: "intro", play: "call:hn harp.b", dyn: 0.48, to: 0.54 },
      { s: "A", play: "mel:vc harp cb", dyn: 0.56 },
      { s: "B", play: "bmel:fl harp vn2 va cb", dyn: 0.6, to: 0.64 },
      { s: "A", play: "mel:cl mel:vc-12 harp va cb", dyn: 0.62 },
      { s: "outro", play: "tag:fl call:hn harp.b va cb", dyn: 0.5, to: 0.34, rit: 0.85 },
    ],
  ],
  rest: [10, 16],
};
