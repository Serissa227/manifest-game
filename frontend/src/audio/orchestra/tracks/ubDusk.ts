// 《傍晚回家的路》管弦版（养成篇的平时曲——傍晚回家，降 E 大调 6/8）：旋律与和声同合成版，按管弦乐重新配器。
// 远处的钟用管钟；圆号唱主题，第一小提琴唱第二句，双簧管唱 B 段想家的那一段，大提琴组走低音，竖琴一直分解和弦；
// 第二小提琴与中提琴的和弦长音很轻，低音提琴拨奏落在每小节的两拍上。没有打击乐。声部一一对应合成版（retarget），两套编配的分段时刻完全一样。
import type { TrackDef } from "../../score";
import { UB_DUSK as SYNTH } from "../../tracks/ubDusk";
import { bass, chords, line, pulse, retarget, SEAT, WET } from "./kit";

export const UB_DUSK: TrackDef = {
  id: "ub_dusk",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.2,
  voices: {
    hn: line("o.hn", 0.46, SEAT.hn, WET.brass),
    vn1: line("o.vn", 0.48, SEAT.vn1, WET.strings),
    ob: line("o.ob", 0.46, SEAT.ob, WET.winds),
    vc: line("o.vc", 0.44, SEAT.vc, WET.strings),
    harpp: pulse("o.harp", 0.28, SEAT.harp, WET.harp, { kind: "arp", low: 51, steps: "1 5 8 10 8 5", ring: 2 }),
    bells: line("o.tubular", 0.14, SEAT.bells, WET.bells),
    vn2: chords("o.vn", 0.1, SEAT.vn2, WET.strings, 63, 75, 2),
    va: chords("o.va", 0.12, SEAT.va, WET.strings, 53, 67, 3),
    cbp: pulse("o.cb.pizz", 0.22, SEAT.cb, WET.low, bass("1 . . 5, . .", 39, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { horn: "hn", vns: "vn1", oboe: "ob", vcs: "vc", hp: "harpp", bell: "bells", pad: "va vn2", pz: "cbp" }),
  rest: SYNTH.rest,
};
