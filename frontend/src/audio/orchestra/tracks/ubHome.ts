// 《晨光里的家》管弦版（养成篇的家乡期，F 大调 3/4，温暖的早晨）：旋律与和声同合成版，按管弦乐重新配器。
// 开头竖琴稀疏的分解和弦，钟琴一串向上的 F 大三和弦（第一道光），单簧管轻轻吹出成长动机；
// A 段长笛唱主题，竖琴托着，低音提琴很轻的长音；再唱一遍时第一小提琴接过来、大管在中音区拉对位，第二小提琴与中提琴的和弦填满中间；
// B 段双簧管唱 D 小调一侧的那段心事（第二遍交给大提琴组在次中音区唱）；尾声长笛、钟琴再亮一下。没有打击乐。
import type { TrackDef } from "../../score";
import { UB_HOME as SYNTH } from "../../tracks/ubHome";
import { chords, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const UB_HOME: TrackDef = {
  id: "ub_home",
  title: SYNTH.title,
  qpm: 88,
  meter: [3, 4],
  key: "F major",
  level: 1.22,
  voices: {
    fl: line("o.fl", 0.5, SEAT.fl, WET.winds),
    cl: line("o.cl", 0.48, SEAT.cl, WET.winds),
    ob: line("o.ob", 0.46, SEAT.ob, WET.winds),
    bn: line("o.bn", 0.4, SEAT.bn, WET.winds),
    vn1: line("o.vn", 0.5, SEAT.vn1, WET.strings),
    vc: line("o.vc", 0.5, SEAT.vc, WET.strings),
    glock: line("o.glock", 0.16, SEAT.glock, WET.bells),
    harp: pulse("o.harp", 0.3, SEAT.harp, WET.harp, {
      a: { kind: "arp", low: 41, steps: "1 5 8 10 12 10", ring: 2 },
      b: { kind: "arp", low: 41, steps: "1 . 8 . 10 .", ring: 3 },
    }),
    vn2: chords("o.vn", 0.12, SEAT.vn2, WET.strings, 65, 77, 2),
    va: chords("o.va", 0.13, SEAT.va, WET.strings, 53, 67, 3),
    cb: chords("o.cb", 0.14, SEAT.cb, WET.low, 29, 41, 1),
  },
  sections: {
    intro: { ...S.intro },
    A: { ...S.A },
    B: { ...S.B },
    outro: { ...S.outro },
  },
  forms: [
    [
      { s: "intro", play: "chime:glock motif:cl harp.b va", dyn: 0.5, to: 0.58 },
      { s: "A", play: "mel:fl harp cb", dyn: 0.6 },
      { s: "A", play: "mel2:vn1 cnt:bn harp vn2 va cb", dyn: 0.64 },
      { s: "B", play: "bmel:ob harp.b va cb", dyn: 0.62 },
      { s: "A", play: "mel2:fl cnt:vc harp vn2 va cb", dyn: 0.64, to: 0.6 },
      { s: "outro", play: "tag:fl chime:glock harp.b va", dyn: 0.55, to: 0.38, rit: 0.85 },
    ],
    [
      { s: "intro", play: "motif:fl harp.b va", dyn: 0.48, to: 0.56 },
      { s: "A", play: "mel:cl harp cb", dyn: 0.6 },
      { s: "B", play: "bmel:vc-12 harp.b va cb", dyn: 0.6 },
      { s: "A", play: "mel2:vn1 cnt:bn harp vn2 va cb", dyn: 0.64, to: 0.6 },
      { s: "outro", play: "tag:cl chime:glock harp.b va", dyn: 0.54, to: 0.36, rit: 0.85 },
    ],
  ],
  rest: [10, 18],
};
