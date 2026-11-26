// 《烈风》管弦版（海上的暴风雨的第二首，G 小调 4/4）：旋律与和声同合成版，按管弦乐配器。
// 大提琴组用跳弓不停地拉八分音符的分解和弦，低音提琴每小节一个长音；小提琴组的颤弓和弦是风，长号的和弦托在下面；
// A 段第一小提琴拉那条焦急的线，B 段圆号与小号吹号角（第二次小提琴高八度齐奏）；定音鼓在 G、降 B 与 D 上重击、滚奏，
// 军鼓碎着，大鼓两小节一下，对击钹八小节一下。声部一一对应合成版（retarget），两套编配的分段时刻完全一样。
import type { TrackDef } from "../../score";
import { STORM_GALE as SYNTH } from "../../tracks/stormGale";
import { bass, chords, line, pulse, retarget, SEAT, WET } from "./kit";

export const STORM_GALE: TrackDef = {
  id: "storm_gale",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  hall: true,
  level: 0.75,
  voices: {
    ost: pulse("o.vc.spic", 0.5, SEAT.vc, 0.24, { kind: "arp", low: 43, steps: "1 5 8 5 10 5 8 5" }),
    cb: line("o.cb", 0.26, SEAT.cb, 0.2, bass("1 . . . . . . .", 31)),
    trem: chords("o.vn.trem", 0.13, SEAT.vn2, 0.38, 60, 76, 3),
    vn1: line("o.vn", 0.56, SEAT.vn1, 0.32),
    tp: line("o.tp", 0.4, SEAT.tp, WET.brass),
    hn: line("o.hn", 0.42, SEAT.hn, WET.brass),
    tb: chords("o.tb", 0.15, SEAT.tb, WET.brass, 45, 60, 3),
    timp: line("o.timp", 0.42, SEAT.timp, 0.3),
    snare: pulse("o.perc", 0.28, -0.15, 0.25, { kind: "drum", steps: "..s...ss", hits: { s: ["snare", 0.34] } }),
    boom: pulse("o.perc", 0.34, 0.05, 0.35, { kind: "drum", steps: "T.......T...t...", hits: { T: ["bd", 0.6], t: ["bd", 0.32] } }),
    cymbal: pulse("o.perc", 0.24, 0.3, 0.4, { kind: "drum", steps: "C" + ".".repeat(63), hits: { C: ["crash", 0.62] } }),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { violins: "vn1", horns: "hn", tpt: "tp", strings: "trem cb", choir: "tb" }),
  rest: SYNTH.rest,
};
