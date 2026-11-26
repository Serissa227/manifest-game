// 《雾号》管弦版（海上起雾，B 小调 4/4，很慢）：旋律与和声同合成版，按管弦乐配器。
// 圆号吹雾号，管钟是船钟，单簧管（低音区）吹断句，长笛吹 B 段，独奏的第一小提琴在再现时接过去；
// 中提琴与大提琴的和弦长音，B 段加一层小提琴组的颤弓（雾更浓），低音提琴一个和弦一个长音。没有打击乐。声部一一对应合成版（retarget）。
import type { TrackDef } from "../../score";
import { SEA_FOG as SYNTH } from "../../tracks/seaFog";
import { chords, line, retarget, SEAT, WET } from "./kit";

export const SEA_FOG: TrackDef = {
  id: "sea_fog",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.46,
  hall: true,
  space: SYNTH.space,
  voices: {
    cl: line("o.cl", 0.44, SEAT.cl, WET.winds),
    fl: line("o.fl", 0.38, SEAT.fl, WET.winds),
    vn: line("o.vn", 0.42, SEAT.vn1, WET.strings),
    hn: line("o.hn", 0.36, SEAT.hn, 0.46),
    bell: line("o.tubular", 0.12, SEAT.bells, WET.bells),
    va: chords("o.va", 0.14, SEAT.va, WET.strings, 54, 69, 3),
    vc: chords("o.vc", 0.1, SEAT.vc, WET.strings, 42, 57, 2),
    trem: chords("o.vn.trem", 0.08, SEAT.vn2, 0.42, 66, 81, 2),
    cb: chords("o.cb", 0.16, SEAT.cb, WET.low, 30, 42, 1),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vc", hi: "trem", low: "cb" }),
  rest: SYNTH.rest,
};
