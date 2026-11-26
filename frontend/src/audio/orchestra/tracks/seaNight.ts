// 《南十字下》管弦版（远洋的夜航，E 大调 4/4，慢）：旋律与和声同合成版，按管弦乐配器。
// 单簧管唱夜曲，独奏的第一小提琴唱 B 段，长笛接着唱再现，大提琴在下面走对旋律；钟琴是星，竖琴很慢地分解和弦；
// 第二小提琴与中提琴的和弦长音很轻，低音提琴一个和弦一个长音。没有打击乐。声部一一对应合成版（retarget）。
import type { TrackDef } from "../../score";
import { SEA_NIGHT as SYNTH } from "../../tracks/seaNight";
import { chords, line, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_NIGHT: TrackDef = {
  id: "sea_night",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.24,
  hall: true,
  space: SYNTH.space,
  voices: {
    cl: line("o.cl", 0.46, SEAT.cl, WET.winds),
    fl: line("o.fl", 0.4, SEAT.fl, WET.winds),
    vn: line("o.vn", 0.44, SEAT.vn1, WET.strings),
    vc: line("o.vc", 0.42, SEAT.vc, WET.strings),
    cel: line("o.glock", 0.14, SEAT.glock, WET.bells),
    harpp: pulse("o.harp", 0.3, SEAT.harp, WET.harp, { kind: "arp", low: 40, steps: "1 . 5 . 8 . 10 .", ring: 4 }),
    vn2: chords("o.vn", 0.09, SEAT.vn2, WET.strings, 59, 73, 2),
    va: chords("o.va", 0.12, SEAT.va, WET.strings, 52, 66, 3),
    cb: chords("o.cb", 0.16, SEAT.cb, WET.low, 28, 40, 1),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { hp: "harpp", pad: "va vn2", low: "cb" }),
  rest: SYNTH.rest,
};
