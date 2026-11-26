// 《海边的风》管弦版（养成篇的平时曲——海边，A 大调 3/4 的圆舞曲）：旋律与和声同合成版，按管弦乐重新配器。
// 钟琴代替钢片琴在高处闪光；长笛唱主题（最后一遍与第一小提琴齐奏），单簧管唱 B 段、第二遍小提琴高八度接过来；
// 竖琴在拍二、拍三上拨和弦，低音提琴拨奏落在第一拍，大提琴组与中提琴很轻的长音。没有打击乐。声部一一对应合成版（retarget），两套编配的分段时刻完全一样。
import type { TrackDef } from "../../score";
import { UB_BREEZE as SYNTH } from "../../tracks/ubBreeze";
import { bass, chords, line, pulse, retarget, SEAT, WET } from "./kit";

export const UB_BREEZE: TrackDef = {
  id: "ub_breeze",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.2,
  voices: {
    fl: line("o.fl", 0.5, SEAT.fl, WET.winds),
    cl: line("o.cl", 0.46, SEAT.cl, WET.winds),
    vn1: line("o.vn", 0.46, SEAT.vn1, WET.strings),
    glock: line("o.glock", 0.14, SEAT.glock, WET.bells),
    harpp: pulse("o.harp", 0.28, SEAT.harp, WET.harp, { kind: "arp", low: 45, steps: "- - 5+8 . 8+10 .", ring: 2 }),
    va: chords("o.va", 0.1, SEAT.va, WET.strings, 57, 71, 3),
    vc: chords("o.vc", 0.1, SEAT.vc, WET.low, 45, 57, 1),
    cbp: pulse("o.cb.pizz", 0.24, SEAT.cb, WET.low, bass("1 . . . . .", 33, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { flute: "fl", reed: "cl", fid: "vn1", cel: "glock", hp: "harpp", pad: "va vc", pz: "cbp" }),
  rest: SYNTH.rest,
};
