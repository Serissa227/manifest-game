// 《熄灯以后》管弦版（养成篇的情境音乐——悲伤，G 小调 4/4，很慢）：旋律与和声同合成版，按管弦乐配器。
// 双簧管唱主题，大提琴独自说 B 段、在再现时走对旋律，独奏的第一小提琴再唱主题，竖琴很慢地分解和弦；
// 第二小提琴与中提琴的和弦长音很轻，低音提琴一个和弦一个长音。没有打击乐。声部一一对应合成版（retarget）。
import type { TrackDef } from "../../score";
import { UB_LAMP_OUT as SYNTH } from "../../tracks/ubLampOut";
import { chords, line, pulse, retarget, SEAT, WET } from "./kit";

export const UB_LAMP_OUT: TrackDef = {
  id: "ub_lamp_out",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.38,
  space: SYNTH.space,
  voices: {
    ob: line("o.ob", 0.44, SEAT.ob, WET.winds),
    vn: line("o.vn", 0.44, SEAT.vn1, WET.strings),
    vc: line("o.vc", 0.46, SEAT.vc, WET.strings),
    harpp: pulse("o.harp", 0.3, SEAT.harp, WET.harp, { kind: "arp", low: 43, steps: "1 . 5 . 8 . 10 .", ring: 4 }),
    vn2: chords("o.vn", 0.09, SEAT.vn2, WET.strings, 60, 74, 2),
    va: chords("o.va", 0.12, SEAT.va, WET.strings, 53, 67, 3),
    cb: chords("o.cb", 0.16, SEAT.cb, WET.low, 31, 43, 1),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { hp: "harpp", pad: "va vn2", low: "cb" }),
  rest: SYNTH.rest,
};
