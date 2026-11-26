// 《长浪》管弦版（远洋上的涌，G 大调 9/8）：旋律与和声同合成版，按管弦乐配器。
// 大提琴组先唱主题，双簧管唱 B 段，第一小提琴高八度再现，圆号的长音对旋律在下面；竖琴九个八分音符一圈地分解和弦，
// 第二小提琴与中提琴的和弦长音很轻，低音提琴拨奏落在每小节的三拍上。没有打击乐。声部一一对应合成版（retarget）。
import type { TrackDef } from "../../score";
import { SEA_SWELL as SYNTH } from "../../tracks/seaSwell";
import { bass, chords, line, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_SWELL: TrackDef = {
  id: "sea_swell",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.29,
  hall: true,
  voices: {
    vn1: line("o.vn", 0.5, SEAT.vn1, WET.strings),
    vc: line("o.vc", 0.5, SEAT.vc, WET.strings),
    ob: line("o.ob", 0.42, SEAT.ob, WET.winds),
    hn: line("o.hn", 0.38, SEAT.hn, WET.brass),
    harpp: pulse("o.harp", 0.28, SEAT.harp, WET.harp, { kind: "arp", low: 43, steps: "1 5 8 10 8 5 8 10 8", ring: 2 }),
    vn2: chords("o.vn", 0.1, SEAT.vn2, WET.strings, 62, 76, 2),
    va: chords("o.va", 0.12, SEAT.va, WET.strings, 52, 67, 3),
    cbp: pulse("o.cb.pizz", 0.24, SEAT.cb, WET.low, bass("1 . . 5, . . 1 . .", 31, 3)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { vns: "vn1", vcs: "vc", horn: "hn", hp: "harpp", pad: "va vn2", pz: "cbp" }),
  rest: SYNTH.rest,
};
