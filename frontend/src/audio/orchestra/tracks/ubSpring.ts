// 《新叶》管弦版（养成篇的平时曲——春天，D 大调 6/8）：旋律与和声同合成版，按管弦乐配器。
// 长笛唱主题，第一小提琴唱答句，双簧管唱 B 段，大提琴走对旋律，竖琴一直分解和弦；
// 第二小提琴与中提琴的和弦长音很轻，低音提琴拨奏落在每小节的两拍上。没有打击乐。声部一一对应合成版（retarget）。
import type { TrackDef } from "../../score";
import { UB_SPRING as SYNTH } from "../../tracks/ubSpring";
import { bass, chords, line, pulse, retarget, SEAT, WET } from "./kit";

export const UB_SPRING: TrackDef = {
  id: "ub_spring",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.11,
  voices: {
    fl: line("o.fl", 0.42, SEAT.fl, WET.winds),
    vn1: line("o.vn", 0.46, SEAT.vn1, WET.strings),
    ob: line("o.ob", 0.44, SEAT.ob, WET.winds),
    vc: line("o.vc", 0.4, SEAT.vc, WET.strings),
    harpp: pulse("o.harp", 0.28, SEAT.harp, WET.harp, { kind: "arp", low: 50, steps: "1 5 8 10 8 5", ring: 2 }),
    vn2: chords("o.vn", 0.1, SEAT.vn2, WET.strings, 62, 76, 2),
    va: chords("o.va", 0.12, SEAT.va, WET.strings, 54, 67, 3),
    cbp: pulse("o.cb.pizz", 0.22, SEAT.cb, WET.low, bass("1 . . 5, . .", 38, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { vns: "vn1", vcs: "vc", hp: "harpp", pad: "va vn2", pz: "cbp" }),
  rest: SYNTH.rest,
};
