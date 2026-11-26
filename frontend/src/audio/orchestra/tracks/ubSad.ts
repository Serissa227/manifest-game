// 《落雨的庭院》管弦版（养成篇的事件 · 悲伤，D 小调慢 3/4，哀歌式的下行低音）：旋律与和声同合成版，按管弦乐重新配器。
// A 段双簧管唱（第二遍大提琴组），再来时第一小提琴与低八度的大提琴组同奏；B 段 F 大调一侧的回忆交给大提琴组（第二遍长笛）；
// 竖琴高处偶尔一个单音是屋檐的雨，竖琴稀疏的分解和弦、第二小提琴与中提琴极轻的和弦、低音提琴的长音托着。
import type { TrackDef } from "../../score";
import { UB_SAD as SYNTH } from "../../tracks/ubSad";
import { chords, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const UB_SAD: TrackDef = {
  id: "ub_sad",
  title: SYNTH.title,
  qpm: 60,
  meter: [3, 4],
  key: "D minor",
  space: 1.15,
  level: 1.38,
  voices: {
    ob: line("o.ob", 0.48, SEAT.ob, 0.4),
    fl: line("o.fl", 0.44, SEAT.fl, 0.42),
    vn1: line("o.vn", 0.48, SEAT.vn1, 0.4),
    vc: line("o.vc", 0.5, SEAT.vc, 0.38),
    drop: line("o.harp", 0.26, SEAT.harp - 0.04, 0.6),
    harp: pulse("o.harp", 0.24, SEAT.harp, WET.harp, { kind: "arp", low: 38, steps: "1 . 5 . 10 .", ring: 3 }),
    vn2: chords("o.vn", 0.1, SEAT.vn2, 0.44, 62, 74, 2),
    va: chords("o.va", 0.11, SEAT.va, 0.42, 53, 67, 3),
    cb: chords("o.cb", 0.15, SEAT.cb, WET.low, 33, 45, 1),
  },
  sections: {
    intro: { ...S.intro },
    A: { ...S.A },
    B: { ...S.B },
    outro: { ...S.outro },
  },
  forms: [
    [
      { s: "intro", play: "drops:drop va cb", dyn: 0.48 },
      { s: "A", play: "mel:ob drops:drop harp cb", dyn: 0.56 },
      { s: "B", play: "bmel:vc-12 drops:drop harp va cb", dyn: 0.58 },
      { s: "A", play: "mel:vn1 mel:vc-12 harp vn2 va cb", dyn: 0.6, to: 0.54 },
      { s: "outro", play: "tag:ob drops:drop va cb", dyn: 0.48, to: 0.34, rit: 0.85 },
    ],
    [
      { s: "intro", play: "drops:drop cb", dyn: 0.46 },
      { s: "A", play: "mel:vc-12 drops:drop harp cb", dyn: 0.56 },
      { s: "B", play: "bmel:fl drops:drop harp va cb", dyn: 0.58 },
      { s: "A", play: "mel:ob harp vn2 va cb", dyn: 0.58, to: 0.52 },
      { s: "outro", play: "tag:vc-12 drops:drop va cb", dyn: 0.46, to: 0.32, rit: 0.85 },
    ],
  ],
  rest: [10, 16],
};
