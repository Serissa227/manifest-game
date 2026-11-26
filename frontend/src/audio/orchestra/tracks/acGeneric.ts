// 《学院的回廊》管弦版（学院的短主题·自创主角，降 B 大调 4/4，成长动机开头）：旋律与和声同合成版，按管弦乐重新配器。
// 单簧管唱 A 段（第二遍第一小提琴），双簧管唱 B 段（第二遍单簧管）；竖琴的分解和弦，大提琴组拨奏一拍一个，中提琴与第二小提琴很轻的和弦。
import type { TrackDef } from "../../score";
import { AC_GENERIC as SYNTH } from "../../tracks/acGeneric";
import { bass, chords, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const AC_GENERIC: TrackDef = {
  id: "ac_generic",
  title: SYNTH.title,
  qpm: 100,
  meter: [4, 4],
  key: "Bb major",
  level: 1.3,
  voices: {
    cl: line("o.cl", 0.5, SEAT.cl, WET.winds),
    ob: line("o.ob", 0.46, SEAT.ob, WET.winds),
    vn1: line("o.vn", 0.48, SEAT.vn1, WET.strings),
    harp: pulse("o.harp", 0.26, SEAT.harp, WET.harp, { kind: "arp", low: 46, steps: "1 5 8 10 12 10 8 5", ring: 2 }),
    vn2: chords("o.vn", 0.1, SEAT.vn2, WET.strings, 62, 74, 2),
    va: chords("o.va", 0.11, SEAT.va, WET.strings, 55, 67, 2),
    vcp: pulse("o.vc.pizz", 0.32, SEAT.vc, WET.low, bass("1 . 5, . 1 . 5, .", 41, 2)),
  },
  sections: {
    A: { ...S.A },
    B: { ...S.B },
  },
  forms: [
    [
      { s: "A", play: "mel:cl harp vcp", dyn: 0.62 },
      { s: "B", play: "bmel:ob harp vn2 va vcp", dyn: 0.64, to: 0.58, rit: 0.92 },
    ],
    [
      { s: "A", play: "mel:vn1 harp va vcp", dyn: 0.62 },
      { s: "B", play: "bmel:cl harp vcp", dyn: 0.62, to: 0.56, rit: 0.92 },
    ],
  ],
  rest: [8, 14],
};
