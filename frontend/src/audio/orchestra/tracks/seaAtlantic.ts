// 《信风带》管弦版（大西洋的远洋，降 B 大调 6/8）：旋律与和声同合成版，按管弦乐配器。
// 第一小提琴唱主题与答句，圆号吹引子的起帆动机与 B 段“长夜的值更”，长笛在再现时跟着小提琴，大提琴组走对旋律与 B 段的低音；
// 竖琴一直分解和弦，第二小提琴与中提琴的和弦长音很轻，低音提琴拨奏落在每小节的两拍上，沙锤只在再现时轻轻摇。
// 声部一一对应合成版（retarget），两套编配的分段时刻完全一样。
import type { TrackDef } from "../../score";
import { SEA_ATLANTIC as SYNTH } from "../../tracks/seaAtlantic";
import { bass, chords, line, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_ATLANTIC: TrackDef = {
  id: "sea_atlantic",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  hall: true,
  voices: {
    vn1: line("o.vn", 0.5, SEAT.vn1, WET.strings),
    hn: line("o.hn", 0.46, SEAT.hn, WET.brass),
    fl: line("o.fl", 0.3, SEAT.fl, WET.winds),
    vc: line("o.vc", 0.44, SEAT.vc, WET.strings),
    harpp: pulse("o.harp", 0.28, SEAT.harp, WET.harp, { kind: "arp", low: 46, steps: "1 5 8 10 8 5", ring: 2 }),
    vn2: chords("o.vn", 0.1, SEAT.vn2, WET.strings, 62, 75, 2),
    va: chords("o.va", 0.12, SEAT.va, WET.strings, 53, 67, 3),
    cbp: pulse("o.cb.pizz", 0.24, SEAT.cb, WET.low, bass("1 . . 5, . .", 34, 2)),
    shk: pulse("o.perc", 0.2, SEAT.perc, WET.perc, { kind: "drum", steps: "s..s.s", hits: { s: ["shaker", 0.3] } }),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { vns: "vn1", horn: "hn", vcs: "vc", hp: "harpp", pad: "va vn2", pz: "cbp" }),
  rest: SYNTH.rest,
};
