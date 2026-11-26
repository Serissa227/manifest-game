// 《长昼》管弦版（养成篇的平时曲——夏天，G 大调 4/4，慢）：旋律与和声同合成版，按管弦乐配器。
// 单簧管唱主题，圆号吹引子与 B 段，第一小提琴再现，大提琴走长音的对旋律，竖琴一直分解和弦；
// 第二小提琴与中提琴的和弦长音很轻，低音提琴拨奏落在每小节的一、三拍上。没有打击乐。声部一一对应合成版（retarget）。
import type { TrackDef } from "../../score";
import { UB_SUMMER as SYNTH } from "../../tracks/ubSummer";
import { bass, chords, line, pulse, retarget, SEAT, WET } from "./kit";

export const UB_SUMMER: TrackDef = {
  id: "ub_summer",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.38,
  voices: {
    cl: line("o.cl", 0.48, SEAT.cl, WET.winds),
    hn: line("o.hn", 0.42, SEAT.hn, WET.brass),
    vn1: line("o.vn", 0.44, SEAT.vn1, WET.strings),
    vc: line("o.vc", 0.4, SEAT.vc, WET.strings),
    harpp: pulse("o.harp", 0.28, SEAT.harp, WET.harp, { kind: "arp", low: 43, steps: "1 5 8 10 12 10 8 5", ring: 2 }),
    vn2: chords("o.vn", 0.1, SEAT.vn2, WET.strings, 62, 76, 2),
    va: chords("o.va", 0.12, SEAT.va, WET.strings, 52, 67, 3),
    cbp: pulse("o.cb.pizz", 0.2, SEAT.cb, WET.low, bass("1 . . . 5 . . .", 31, 3)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { vns: "vn1", vcs: "vc", hp: "harpp", pad: "va vn2", pz: "cbp" }),
  rest: SYNTH.rest,
};
