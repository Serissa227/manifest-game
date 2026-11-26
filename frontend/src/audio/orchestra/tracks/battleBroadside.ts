// 《舷炮》管弦版（海战的第二首，E 小调 4/4）：旋律与和声同合成版，按管弦乐配器。
// 大提琴组用跳弓拉八分音符的固定音型，低音提琴每小节两个长音；小号吹号角一样的主题，圆号低八度跟着、在 B 段走对旋律，
// 第一小提琴拉 B 段的宽旋律（最后一遍高八度加进主题）；小提琴组的颤弓和弦与长号的和弦垫着；定音鼓在 E、B 上重击与滚奏，
// 军鼓敲行进的节奏，大鼓压在两个强拍上，对击钹八小节一下。声部一一对应合成版（retarget），两套编配的分段时刻完全一样。
import type { TrackDef } from "../../score";
import { BATTLE_BROADSIDE as SYNTH } from "../../tracks/battleBroadside";
import { bass, chords, line, pulse, retarget, SEAT, WET } from "./kit";

export const BATTLE_BROADSIDE: TrackDef = {
  id: "battle_broadside",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 0.68,
  voices: {
    ost: pulse("o.vc.spic", 0.5, SEAT.vc, 0.24, { kind: "arp", low: 40, steps: "1 1 5 1 3 1 5 1" }),
    cb: line("o.cb", 0.26, SEAT.cb, 0.2, bass("1 . . . 1 . . .", 28)),
    trem: chords("o.vn.trem", 0.12, SEAT.vn2, 0.36, 59, 76, 3),
    tb: chords("o.tb", 0.14, SEAT.tb, WET.brass, 45, 60, 3),
    tp: line("o.tp", 0.44, SEAT.tp, WET.brass),
    hn: line("o.hn", 0.42, SEAT.hn, WET.brass),
    vn1: line("o.vn", 0.56, SEAT.vn1, 0.32),
    timp: line("o.timp", 0.42, SEAT.timp, 0.3),
    snare: pulse("o.perc", 0.28, -0.14, 0.24, { kind: "drum", steps: "s.sss.ss", hits: { s: ["snare", 0.34] } }),
    boom: pulse("o.perc", 0.34, 0.05, 0.34, { kind: "drum", steps: "T...T...", hits: { T: ["bd", 0.58] } }),
    cymbal: pulse("o.perc", 0.24, 0.3, 0.4, { kind: "drum", steps: "C" + ".".repeat(63), hits: { C: ["crash", 0.62] } }),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { tpt: "tp", horns: "hn", violins: "vn1", strings: "trem tb cb" }),
  rest: SYNTH.rest,
};
