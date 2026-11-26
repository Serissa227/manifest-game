// 《晒场上的风》管弦版（养成篇的平时曲——秋天，A 多利亚 4/4，收成时节的舞曲）：旋律与和声同合成版，按管弦乐配器。
// 独奏的第一小提琴领奏，长笛唱答句，单簧管唱 B 段；小提琴组的拨奏分解和弦（合成版是鲁特琴），第二小提琴与中提琴的和弦长音很轻，
// 大提琴组与低音提琴拨奏走低音，铃鼓与响棒点着步子。声部一一对应合成版（retarget），两套编配的分段时刻完全一样。
import type { TrackDef } from "../../score";
import { UB_AUTUMN as SYNTH } from "../../tracks/ubAutumn";
import { bass, chords, line, pulse, retarget, SEAT, WET } from "./kit";

export const UB_AUTUMN: TrackDef = {
  id: "ub_autumn",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.22,
  voices: {
    fid: line("o.vn", 0.48, SEAT.vn1, WET.strings),
    fl: line("o.fl", 0.4, SEAT.fl, WET.winds),
    cl: line("o.cl", 0.46, SEAT.cl, WET.winds),
    vnp: pulse("o.vn.pizz", 0.22, SEAT.vn2, 0.22, { kind: "arp", low: 57, steps: "1 5 8 5 10 5 8 5", ring: 1 }),
    vn2: chords("o.vn", 0.09, SEAT.vn2, WET.strings, 62, 76, 2),
    va: chords("o.va", 0.11, SEAT.va, WET.strings, 52, 67, 3),
    vcp: pulse("o.vc.pizz", 0.22, SEAT.vc, WET.low, bass("1 . . . 5 . 1 .", 45, 2)),
    cbp: pulse("o.cb.pizz", 0.2, SEAT.cb, WET.low, bass("1 . . . 1 . . .", 33, 2)),
    drum: pulse("o.perc", 0.24, SEAT.perc, WET.perc, { kind: "drum", steps: "T..rT.r.", hits: { T: ["claves", 0.4], r: ["tamb", 0.34] } }),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { lute: "vnp", pad: "va vn2", pz: "vcp cbp" }),
  rest: SYNTH.rest,
};
