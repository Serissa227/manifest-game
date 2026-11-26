// 《白墙与钟楼》管弦版（埃斯佩兰王国的港口，地中海风；A 小调 6/8 的塔兰泰拉）：旋律与和声同合成版，按管弦乐重新配器。
// 曼陀林的旋律改成小提琴组的跳弓（轻快、有弹性），第二遍单簧管在下方加一条和声；B 段转到 C 大调一侧，长笛与双簧管同度唱；
// 吉他的扫弦是小提琴组拨奏的扫弦与竖琴，大提琴组拨奏落在第一、四拍；铃鼓“击 · 摇 击 · 摇”是地中海的颜色，大鼓在第一拍轻轻一下；
// 开头远处钟楼的管钟敲一下。
import type { TrackDef } from "../../score";
import { MEDITERRANEAN as SYNTH } from "../../tracks/mediterranean";
import { bass, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const MEDITERRANEAN: TrackDef = {
  id: "port_mediterranean",
  title: SYNTH.title,
  qpm: 144,
  meter: [6, 8],
  key: "A minor",
  voices: {
    spic: line("o.vn.spic", 0.54, SEAT.vn1, 0.24),
    vn1: line("o.vn", 0.46, SEAT.vn1, 0.26),
    fl: line("o.fl", 0.46, SEAT.fl, 0.28),
    ob: line("o.ob", 0.42, SEAT.ob, 0.28),
    cl: line("o.cl", 0.36, SEAT.cl, 0.26),
    strum: pulse("o.vn.pizz", 0.2, SEAT.vn2, 0.2, { kind: "strum", low: 55, high: 72, steps: "D . u D . u", spread: 0.01 }),
    harp: pulse("o.harp", 0.2, SEAT.harp, 0.26, { kind: "arp", low: 45, steps: "1 . 8+10 1 . 8+10", ring: 2 }),
    vcp: pulse("o.vc.pizz", 0.4, SEAT.vc, WET.low, bass("1 . . 5 . .", 36, 2)),
    cbp: pulse("o.cb.pizz", 0.28, SEAT.cb, WET.low, bass("1 . . . . .", 28, 3)),
    tamb: pulse("o.perc", 0.34, -0.3, 0.22, { kind: "drum", steps: "X.xX.x", hits: { X: ["tamb", 0.5], x: ["shake", 0.3] } }),
    drum: pulse("o.perc", 0.26, 0.15, 0.22, { kind: "drum", steps: "D..d..", hits: { D: ["bd", 0.46], d: ["bd", 0.26] } }),
    bell: line("o.tubular", 0.3, SEAT.bells, 0.6),
  },
  sections: {
    intro: { ...S.intro },
    A: { ...S.A },
    B: { ...S.B },
  },
  forms: [
    [
      { s: "intro", play: "bell:bell strum tamb", dyn: 0.62 },
      { s: "A", play: "mel:spic strum vcp cbp tamb", dyn: 0.66 },
      { s: "A", play: "mel:spic harm:cl strum harp vcp cbp tamb drum", dyn: 0.72 },
      { s: "B", play: "mel:fl mel:ob strum vcp cbp tamb drum", dyn: 0.72 },
      { s: "B", play: "mel:vn1 mel:fl harm:cl strum harp vcp cbp tamb drum", dyn: 0.78, rit: 0.9 },
    ],
    [
      { s: "A", play: "mel:vn1 strum vcp cbp", dyn: 0.62 },
      { s: "A", play: "mel:spic harm:cl strum harp vcp cbp tamb", dyn: 0.7 },
      { s: "B", play: "mel:fl mel:spic strum vcp cbp tamb drum", dyn: 0.72 },
      { s: "B", play: "mel:ob harm:vn1 strum harp vcp cbp tamb drum", dyn: 0.76, rit: 0.9 },
    ],
  ],
  rest: [10, 18],
};
