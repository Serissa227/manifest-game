// 《指尖的余温》管弦版（养成篇的心动，降 B 大调慢 4/4，温柔、克制）：旋律与和声同合成版，按管弦乐重新配器。
// 第一小提琴与大提琴组是那两个错开说话的人；竖琴的分解和弦，第二小提琴与中提琴很轻的和弦长音，低音提琴一小节一个长音；
// B 段经过降 E 小三和弦的那一小节，圆号在中音区轻轻托一个和弦（只在 B 段）；第二遍 B 段的旋律交给单簧管。
import type { TrackDef } from "../../score";
import { UB_HEART as SYNTH } from "../../tracks/ubHeart";
import { chords, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const UB_HEART: TrackDef = {
  id: "ub_heart",
  title: SYNTH.title,
  qpm: 66,
  meter: [4, 4],
  key: "Bb major",
  level: 1.08,
  voices: {
    vn1: line("o.vn", 0.5, SEAT.vn1, 0.38),
    vc: line("o.vc", 0.52, SEAT.vc, 0.36),
    cl: line("o.cl", 0.46, SEAT.cl, 0.38),
    harp: pulse("o.harp", 0.28, SEAT.harp, WET.harp, {
      a: { kind: "arp", low: 46, steps: "1 5 8 10 12 10 8 5", ring: 2 },
      b: { kind: "arp", low: 46, steps: "1 . 8 . 10 . 12 .", ring: 3 },
    }),
    vn2: chords("o.vn", 0.1, SEAT.vn2, 0.42, 65, 77, 2),
    va: chords("o.va", 0.11, SEAT.va, 0.4, 55, 67, 3),
    hnp: chords("o.hn", 0.1, SEAT.hn, WET.brass, 50, 62, 3),
    cb: chords("o.cb", 0.14, SEAT.cb, WET.low, 31, 43, 1),
  },
  sections: {
    intro: { ...S.intro },
    A: { ...S.A },
    B: { ...S.B },
    outro: { ...S.outro },
  },
  forms: [
    [
      { s: "intro", play: "harp.b cb", dyn: 0.5 },
      { s: "A", play: "vmel:vn1 harp cb", dyn: 0.56 },
      { s: "A", play: "vmel:vn1 cmel:vc harp va cb", dyn: 0.6 },
      { s: "B", play: "bmel:vn1 bcnt:vc harp.b vn2 va hnp cb", dyn: 0.62, to: 0.66 },
      { s: "outro", play: "tag:vn1 harp.b va cb", dyn: 0.52, to: 0.36, rit: 0.85 },
    ],
    [
      { s: "intro", play: "harp.b", dyn: 0.48 },
      { s: "A", play: "vmel:vc-12 harp cb", dyn: 0.56 },
      { s: "B", play: "bmel:cl bcnt:vc harp.b vn2 va cb", dyn: 0.6, to: 0.64 },
      { s: "A", play: "vmel:vn1 cmel:vc harp va cb", dyn: 0.6, to: 0.54 },
      { s: "outro", play: "tag:cl harp.b va cb", dyn: 0.5, to: 0.34, rit: 0.85 },
    ],
  ],
  rest: [8, 14],
};
