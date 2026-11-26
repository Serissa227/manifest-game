// 《决胜局》管弦版（养成篇的情境音乐——比赛，F 大调 6/8）：旋律与和声同合成版，按管弦乐配器。
// 大提琴组用跳弓不停地拉分解和弦，低音提琴每小节一个长音；小号吹主题，第一小提琴接过去冲得更高，圆号低八度跟着，
// 长笛与单簧管隔着八度吹 B 段；小提琴组的颤弓和弦与长号的和弦垫着；定音鼓在 F、降 B、C、D 上重击与滚奏，
// 军鼓敲跑步的节奏，大鼓压在两拍上，对击钹八小节一下。声部一一对应合成版（retarget），两套编配的分段时刻完全一样。
import type { TrackDef } from "../../score";
import { UB_FINAL as SYNTH } from "../../tracks/ubFinal";
import { bass, chords, line, pulse, retarget, SEAT, WET } from "./kit";

export const UB_FINAL: TrackDef = {
  id: "ub_final",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 0.73,
  voices: {
    tp: line("o.tp", 0.44, SEAT.tp, WET.brass),
    hn: line("o.hn", 0.42, SEAT.hn, WET.brass),
    vn1: line("o.vn", 0.52, SEAT.vn1, 0.32),
    fl: line("o.fl", 0.4, SEAT.fl, WET.winds),
    cl: line("o.cl", 0.4, SEAT.cl, WET.winds),
    ost: pulse("o.vc.spic", 0.46, SEAT.vc, 0.24, { kind: "arp", low: 41, steps: "1 5 8 5 3 5" }),
    cb: line("o.cb", 0.24, SEAT.cb, 0.2, bass("1 . . . . .", 29)),
    trem: chords("o.vn.trem", 0.11, SEAT.vn2, 0.36, 60, 77, 3),
    tb: chords("o.tb", 0.13, SEAT.tb, WET.brass, 45, 60, 3),
    timp: line("o.timp", 0.4, SEAT.timp, 0.3),
    snare: pulse("o.perc", 0.26, -0.14, 0.24, { kind: "drum", steps: "s.ss.s", hits: { s: ["snare", 0.32] } }),
    boom: pulse("o.perc", 0.32, 0.05, 0.34, { kind: "drum", steps: "T..t..", hits: { T: ["bd", 0.56], t: ["bd", 0.3] } }),
    cymbal: pulse("o.perc", 0.22, 0.3, 0.4, { kind: "drum", steps: "C" + ".".repeat(47), hits: { C: ["crash", 0.6] } }),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { tpt: "tp", horns: "hn", violins: "vn1", strings: "trem tb cb" }),
  rest: SYNTH.rest,
};
