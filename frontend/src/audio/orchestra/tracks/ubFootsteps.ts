// 《巷子里的脚步》管弦版（养成篇的情境音乐——紧张，C 小调 4/4）：旋律与和声同合成版，按管弦乐配器。
// 大提琴组与低音提琴的拨奏一步一步地走，响棒滴答着；单簧管在低处吹断开的短句，第一小提琴在高处拉慢慢爬的长线，
// 圆号吹 B 段压低了的号角；小提琴组的颤弓和弦很轻，定音鼓轻轻地敲、句尾滚奏。声部一一对应合成版（retarget）。
import type { TrackDef } from "../../score";
import { UB_FOOTSTEPS as SYNTH } from "../../tracks/ubFootsteps";
import { bass, chords, line, pulse, retarget, SEAT, WET } from "./kit";

export const UB_FOOTSTEPS: TrackDef = {
  id: "ub_footsteps",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.43,
  voices: {
    cl: line("o.cl", 0.46, SEAT.cl, 0.28),
    vn1: line("o.vn", 0.4, SEAT.vn1, WET.strings),
    hn: line("o.hn", 0.42, SEAT.hn, WET.brass),
    trem: chords("o.vn.trem", 0.08, SEAT.vn2, 0.38, 60, 77, 3),
    vcp: pulse("o.vc.pizz", 0.3, SEAT.vc, 0.16, { kind: "arp", low: 36, steps: "1 . 5 . 8 . 5 .", ring: 1 }),
    cbp: pulse("o.cb.pizz", 0.2, SEAT.cb, 0.16, bass("1 . . . 1 . . .", 26, 2)),
    timp: line("o.timp", 0.3, SEAT.timp, 0.3),
    wb: pulse("o.perc", 0.2, 0.24, 0.2, { kind: "drum", steps: "w...w.w.", hits: { w: ["claves", 0.4] } }),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { vns: "vn1", pad: "trem", pz: "vcp cbp" }),
  rest: SYNTH.rest,
};
