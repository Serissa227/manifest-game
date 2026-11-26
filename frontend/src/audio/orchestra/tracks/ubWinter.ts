// 《长夜的灯》管弦版（养成篇的平时曲——冬天，降 A 大调 3/4）：旋律与和声同合成版，按管弦乐配器。
// 大提琴唱主题，第一小提琴唱答句，双簧管唱 B 段，钟琴是灯花，竖琴一直分解和弦；
// 第二小提琴与中提琴的和弦长音很轻，低音提琴一个和弦一个长音。没有打击乐。声部一一对应合成版（retarget）。
import type { TrackDef } from "../../score";
import { UB_WINTER as SYNTH } from "../../tracks/ubWinter";
import { chords, line, pulse, retarget, SEAT, WET } from "./kit";

export const UB_WINTER: TrackDef = {
  id: "ub_winter",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.29,
  space: SYNTH.space,
  voices: {
    vc: line("o.vc", 0.5, SEAT.vc, WET.strings),
    vn1: line("o.vn", 0.44, SEAT.vn1, WET.strings),
    ob: line("o.ob", 0.42, SEAT.ob, WET.winds),
    cel: line("o.glock", 0.13, SEAT.glock, WET.bells),
    harpp: pulse("o.harp", 0.3, SEAT.harp, WET.harp, { kind: "arp", low: 44, steps: "1 5 8 10 8 5", ring: 2 }),
    vn2: chords("o.vn", 0.09, SEAT.vn2, WET.strings, 60, 75, 2),
    va: chords("o.va", 0.12, SEAT.va, WET.strings, 53, 67, 3),
    cb: chords("o.cb", 0.16, SEAT.cb, WET.low, 32, 44, 1),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { vns: "vn1", hp: "harpp", pad: "va vn2", low: "cb" }),
  rest: SYNTH.rest,
};
