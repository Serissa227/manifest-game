// 《阿斯特里亚的海岸》管弦版（新大陆沿岸，A 混合利底亚，6/8，开阔、有点野、满怀希望）：旋律与和声同合成版，按管弦乐重新配器。
// 开头圆号吹起帆动机，像望见了一条新海岸；A 段小提琴组领奏（第二句停在还原 G 上，混合利底亚的“拓荒”色彩），重复时交给双簧管；
// 吉他的扫弦改成小提琴组拨奏的扫弦与竖琴，大提琴组拨奏、低音提琴落在第一、四拍，大鼓与铃鼓轻轻推着走；
// B 段转到 D 大调一侧，圆号在中音区唱一条慢慢下行的内声部，中提琴与第二小提琴的和弦长音铺开；最后全奏时长笛在高八度与小提琴齐奏。
import type { TrackDef } from "../../score";
import { SEA_NEW as SYNTH } from "../../tracks/seaNew";
import { bass, chords, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const SEA_NEW: TrackDef = {
  id: "sea_new",
  title: SYNTH.title,
  qpm: 100,
  meter: [6, 8],
  key: "A mixolydian",
  voices: {
    vn1: line("o.vn", 0.52, SEAT.vn1, WET.strings),
    ob: line("o.ob", 0.52, SEAT.ob, WET.winds),
    fl: line("o.fl", 0.38, SEAT.fl, WET.winds),
    hn: line("o.hn", 0.46, SEAT.hn, WET.brass),
    strum: pulse("o.vn.pizz", 0.2, SEAT.vn2, WET.strings, { kind: "strum", low: 57, high: 76, steps: "D . u D . u", spread: 0.012 }),
    harp: pulse("o.harp", 0.22, SEAT.harp, WET.harp, { kind: "arp", low: 45, steps: "1 5 8 10 8 5", ring: 2 }),
    vn2: chords("o.vn", 0.12, SEAT.vn2, WET.strings, 64, 76, 2),
    va: chords("o.va", 0.13, SEAT.va, WET.strings, 55, 67, 3),
    vcp: pulse("o.vc.pizz", 0.42, SEAT.vc, WET.low, bass("1 . . 5 . .", 40, 2)),
    cb: pulse("o.cb.pizz", 0.3, SEAT.cb, WET.low, bass("1 . . 1 . .", 28, 2)),
    perc: pulse("o.perc", 0.32, SEAT.perc, WET.perc, { kind: "drum", steps: "B..b.s", hits: { B: ["bd", 0.4], b: ["bd", 0.24], s: ["shake", 0.3] } }),
  },
  sections: {
    intro: { ...S.intro },
    A: { ...S.A },
    B: { ...S.B },
    outro: { ...S.outro },
  },
  forms: [
    [
      { s: "intro", play: "motif:hn strum vcp cb perc", dyn: 0.56, to: 0.64 },
      { s: "A", play: "mel:vn1 strum vcp cb perc", dyn: 0.66 },
      { s: "A", play: "mel:ob strum harp vcp cb perc va", dyn: 0.66 },
      { s: "B", play: "mel:vn1 low:hn strum vcp cb perc va vn2", dyn: 0.68, to: 0.74 },
      { s: "B", play: "mel:vn1 mel:ob low:hn strum harp vcp cb perc va vn2", dyn: 0.7 },
      { s: "A", play: "mel:vn1 mel:fl+12 strum harp vcp cb perc va vn2", dyn: 0.74 },
      { s: "outro", play: "tag:vn1 strum vcp cb va", dyn: 0.6, to: 0.4, rit: 0.85 },
    ],
    [
      { s: "intro", play: "motif:hn strum vcp", dyn: 0.54, to: 0.62 },
      { s: "A", play: "mel:ob strum vcp cb perc", dyn: 0.64 },
      { s: "A", play: "mel:vn1 strum harp vcp cb perc va", dyn: 0.66 },
      { s: "B", play: "mel:ob low:hn strum vcp cb perc va vn2", dyn: 0.68, to: 0.72 },
      { s: "B", play: "mel:vn1 low:hn strum harp vcp cb perc va vn2", dyn: 0.72 },
      { s: "A", play: "mel:vn1 mel:fl+12 strum harp vcp cb perc va vn2", dyn: 0.74 },
      { s: "outro", play: "tag:ob strum vcp cb va", dyn: 0.58, to: 0.38, rit: 0.85 },
    ],
  ],
  rest: [25, 45],
};
