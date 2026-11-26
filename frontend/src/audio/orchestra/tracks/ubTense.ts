// 《暗涌》管弦版（养成篇的事件 · 紧张，A 小调 4/4）：旋律与和声同合成版，按管弦乐重新配器。
// 大提琴组用跳弓拉那个低处的固定音型，低音提琴一小节一个长音；高处小提琴组极轻的颤弓和弦是绷着的那根弦；
// A 段零碎的动机给单簧管的低音区（第二遍大管），B 段圆号在低处一步步往上走（第二遍第一小提琴同奏），定音鼓偶尔一下、句尾滚奏。
import type { TrackDef } from "../../score";
import { UB_TENSE as SYNTH } from "../../tracks/ubTense";
import { bass, chords, line, SEAT } from "./kit";

const S = SYNTH.sections;

export const UB_TENSE: TrackDef = {
  id: "ub_tense",
  title: SYNTH.title,
  qpm: 100,
  meter: [4, 4],
  key: "A minor",
  level: 1.25,
  voices: {
    ost: line("o.vc.spic", 0.36, SEAT.vc, 0.24),
    cb: line("o.cb", 0.15, SEAT.cb, 0.22, bass("1 . . . . . . .", 28)),
    trem: chords("o.vn.trem", 0.13, SEAT.vn2, 0.44, 64, 81, 3),
    cl: line("o.cl", 0.48, SEAT.cl, 0.34),
    bn: line("o.bn", 0.46, SEAT.bn, 0.32),
    vn1: line("o.vn", 0.46, SEAT.vn1, 0.34),
    hn: line("o.hn", 0.44, SEAT.hn, 0.38),
    timp: line("o.timp", 0.36, SEAT.timp, 0.32),
  },
  sections: {
    intro: { ...S.intro },
    A: { ...S.A },
    B: { ...S.B },
  },
  forms: [
    [
      { s: "intro", play: "ost:ost cb timp:timp", dyn: 0.58, to: 0.64 },
      { s: "A", play: "ost:ost frag:cl cb trem timp:timp", dyn: 0.62 },
      { s: "B", play: "ost:ost bline:hn-12 cb trem timp:timp", dyn: 0.64, to: 0.7 },
      { s: "A", play: "ost:ost frag:vn1+12 cb trem timp:timp", dyn: 0.66 },
    ],
    [
      { s: "intro", play: "ost:ost trem", dyn: 0.58, to: 0.64 },
      { s: "A", play: "ost:ost frag:bn cb timp:timp", dyn: 0.62 },
      { s: "B", play: "ost:ost bline:vn1 bline:hn-12 cb trem timp:timp", dyn: 0.66, to: 0.72 },
      { s: "A", play: "ost:ost frag:cl cb trem timp:timp", dyn: 0.64 },
    ],
  ],
  rest: [3, 6],
};
