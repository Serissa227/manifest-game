// 《并肩的归途》管弦版（养成篇的情境音乐——心动，A 大调 6/8）：旋律与和声同合成版，按管弦乐配器。
// 独奏的第一小提琴唱主题，单簧管在再现时三度、六度地陪着，大提琴唱 B 段，长笛在尾声跟着小提琴，竖琴一直分解和弦；
// 第二小提琴与中提琴的和弦长音很轻，低音提琴拨奏落在每小节的两拍上。没有打击乐。声部一一对应合成版（retarget）。
import type { TrackDef } from "../../score";
import { UB_HEART_WALK as SYNTH } from "../../tracks/ubHeartWalk";
import { bass, chords, line, pulse, retarget, SEAT, WET } from "./kit";

export const UB_HEART_WALK: TrackDef = {
  id: "ub_heart_walk",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.22,
  voices: {
    vn: line("o.vn", 0.48, SEAT.vn1, WET.strings),
    cl: line("o.cl", 0.42, SEAT.cl, WET.winds),
    vc: line("o.vc", 0.46, SEAT.vc, WET.strings),
    fl: line("o.fl", 0.34, SEAT.fl, WET.winds),
    harpp: pulse("o.harp", 0.3, SEAT.harp, WET.harp, { kind: "arp", low: 45, steps: "1 5 8 10 8 5", ring: 2 }),
    vn2: chords("o.vn", 0.09, SEAT.vn2, WET.strings, 61, 76, 2),
    va: chords("o.va", 0.12, SEAT.va, WET.strings, 54, 68, 3),
    cbp: pulse("o.cb.pizz", 0.2, SEAT.cb, WET.low, bass("1 . . 5 . .", 33, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { hp: "harpp", pad: "va vn2", pz: "cbp" }),
  rest: SYNTH.rest,
};
