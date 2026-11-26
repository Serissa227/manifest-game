// 《维斯塔海的风》管弦版（内海，G 混合利底亚，6/8 的水手号子）：旋律与和声同合成版，按管弦乐重新配器。
// 律动：大提琴组与低音提琴拨奏落在第一、四拍，竖琴与第二小提琴的拨奏和弦在第三、六拍（“嘭 · 嚓 嘭 · 嚓”，船身随浪起伏），铃鼓轻轻摇。
// 开头圆号在低处远远吹起帆动机；主歌是领唱与水手的一问一答：双簧管领两小节、小提琴组答两小节，重唱时圆号低八度加进“水手”；
// 副歌大家齐唱：第一小提琴与双簧管同度，第二遍长笛再高八度，圆号在下面唱十度与八度，中提琴的和弦长音把和声填满；
// 中段转到 E 小调一侧，大提琴组在次中音区拉一条长线（第二遍换成单簧管），高处小提琴的和弦像大浪涌过来。
import type { TrackDef } from "../../score";
import { SEA as SYNTH } from "../../tracks/sea";
import { bass, chords, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const SEA: TrackDef = {
  id: "sea",
  title: SYNTH.title,
  qpm: 96,
  meter: [6, 8],
  key: "G mixolydian",
  level: 0.9,
  voices: {
    ob: line("o.ob", 0.56, SEAT.ob, WET.winds),
    fl: line("o.fl", 0.4, SEAT.fl, WET.winds),
    cl: line("o.cl", 0.52, SEAT.cl, WET.winds),
    vn1: line("o.vn", 0.52, SEAT.vn1, WET.strings),
    vhi: chords("o.vn", 0.16, SEAT.vn2, 0.36, 67, 79, 3),
    va: chords("o.va", 0.2, SEAT.va, WET.strings, 55, 67, 3),
    vcm: line("o.vc", 0.56, SEAT.vc, WET.strings),
    hn: line("o.hn", 0.46, SEAT.hn, WET.brass),
    hnp: chords("o.hn", 0.15, SEAT.hn, WET.brass, 50, 62, 3),
    // 拨奏的低音：第一、四拍
    vcp: pulse("o.vc.pizz", 0.42, SEAT.vc, WET.low, bass("1 . . 5 . .", 40, 2)),
    cbp: pulse("o.cb.pizz", 0.36, SEAT.cb, WET.low, bass("1 . . 1 . .", 28, 2)),
    // 拨奏的和弦：第三、六拍
    vnp: pulse("o.vn.pizz", 0.24, SEAT.vn2, WET.strings, { a: bass("- - 10+12 - - 10+12", 55), c: bass("- - 10+12 - - -", 55) }),
    harp: pulse("o.harp", 0.26, SEAT.harp, WET.harp, {
      a: { kind: "arp", low: 43, steps: "- - 8+10+12 - - 8+10+12", ring: 2 },
      c: { kind: "arp", low: 43, steps: "1 5 8 10 8 5", ring: 2 },
    }),
    perc: pulse("o.perc", 0.34, SEAT.perc, WET.perc, {
      a: { kind: "drum", steps: "..s..s", hits: { s: ["shake", 0.4] } },
      b: { kind: "drum", steps: "B.sb.s", hits: { B: ["bd", 0.45], b: ["bd", 0.28], s: ["shake", 0.42] } },
    }),
  },
  sections: {
    intro: { ...S.intro },
    verse: { ...S.verse },
    chorus: { ...S.chorus },
    bridge: { ...S.bridge },
    outro: { ...S.outro },
  },
  forms: [
    [
      { s: "intro", play: "motif:hn vcp cbp harp perc", dyn: 0.55, to: 0.64 },
      { s: "verse", play: "lead:ob crew:vn1 vcp cbp vnp harp perc", dyn: 0.66 },
      { s: "chorus", play: "mel:vn1 mel:ob low:hn va vcp cbp vnp harp perc.b", dyn: 0.72 },
      { s: "bridge", play: "mel:vcm-12 vhi hnp harp.c cbp", dyn: 0.66, to: 0.74 },
      { s: "verse", play: "lead2:ob crew:vn1 crew:hn-12 vcp cbp vnp harp perc", dyn: 0.7 },
      { s: "chorus", play: "mel:vn1 mel:ob mel:fl+12 low:hn va vcp cbp vnp harp perc.b", dyn: 0.76 },
      { s: "outro", play: "tag:ob va vcp cbp vnp.c harp.c", dyn: 0.6, to: 0.42, rit: 0.8 },
    ],
    [
      { s: "intro", play: "motif:hn vcp cbp harp", dyn: 0.52, to: 0.62 },
      { s: "verse", play: "lead:vn1 crew:cl vcp cbp vnp harp perc", dyn: 0.64 },
      { s: "chorus", play: "mel:vn1 mel:fl+12 low:cl va vcp cbp vnp harp perc", dyn: 0.7 },
      { s: "bridge", play: "mel:cl-12 vhi hnp harp.c cbp", dyn: 0.64, to: 0.72 },
      { s: "verse", play: "lead2:ob crew:vn1 crew:hn-12 vcp cbp vnp harp perc", dyn: 0.7 },
      { s: "chorus", play: "mel:vn1 mel:ob mel:fl+12 low:hn va vcp cbp vnp harp perc.b", dyn: 0.74 },
      { s: "outro", play: "tag:vn1 va vcp cbp vnp.c harp.c", dyn: 0.58, to: 0.4, rit: 0.8 },
    ],
  ],
  rest: [25, 45],
};
