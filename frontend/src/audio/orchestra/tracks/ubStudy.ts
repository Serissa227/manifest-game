// 《灯下的功课》管弦版（养成篇的平时曲——读书与练习，C 大调 4/4）：旋律与和声同合成版，按管弦乐重新配器。
// 竖琴代替羽管键琴弹引子的音阶与 A 段分解的低音；长笛唱主题，单簧管（代替竖笛）在下方三度跟着，大提琴组走低音；
// B 段第一小提琴唱，竖琴分解和弦；第二小提琴与中提琴的和弦长音很轻，低音提琴拨奏落在第一、三拍。没有打击乐。
// 声部一一对应合成版（retarget），两套编配的分段时刻完全一样。
import type { TrackDef } from "../../score";
import { UB_STUDY as SYNTH } from "../../tracks/ubStudy";
import { bass, chords, line, pulse, retarget, SEAT, WET } from "./kit";

export const UB_STUDY: TrackDef = {
  id: "ub_study",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.2,
  voices: {
    fl: line("o.fl", 0.5, SEAT.fl, WET.winds),
    cl: line("o.cl", 0.46, SEAT.cl, WET.winds),
    vn1: line("o.vn", 0.48, SEAT.vn1, WET.strings),
    vc: line("o.vc", 0.46, SEAT.vc, WET.strings),
    harp: line("o.harp", 0.34, SEAT.harp, WET.harp),
    harpp: pulse("o.harp", 0.22, SEAT.harp, WET.harp, { kind: "arp", low: 48, steps: "1 5 8 5 10 8 5 8", ring: 2 }),
    vn2: chords("o.vn", 0.1, SEAT.vn2, WET.strings, 62, 74, 2),
    va: chords("o.va", 0.12, SEAT.va, WET.strings, 53, 67, 3),
    cbp: pulse("o.cb.pizz", 0.22, SEAT.cb, WET.low, bass("1 . . . 5 . . .", 36, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { flute: "fl", rec: "cl", fid: "vn1", cello: "vc", hc: "harp", hcp: "harpp", pad: "va vn2", pz: "cbp" }),
  rest: SYNTH.rest,
};
