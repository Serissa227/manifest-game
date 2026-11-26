// 《拓荒者的篝火》管弦版（新大陆的殖民地与荒野海湾，开拓者风；A 多利亚 3/4 的慢圆舞）：旋律与和声同合成版，按管弦乐重新配器。
// 营火边的小提琴旋律交给小提琴组（有点寂寞的调子），第二遍开头由竖琴弹；吉他“嘭 · 恰 · 恰”的圆舞伴奏改成
// 大提琴组每小节一个长音、低音提琴拨奏在第一拍、小提琴组拨奏的和弦在第二、三拍；B 段升到高处，第二次长笛在上方和一条高声部，
// 中提琴的和弦长音把和声填满；大鼓在第一拍轻轻一下。
import type { TrackDef } from "../../score";
import { FRONTIER as SYNTH } from "../../tracks/frontier";
import { bass, chords, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const FRONTIER: TrackDef = {
  id: "port_frontier",
  title: SYNTH.title,
  qpm: 96,
  meter: [3, 4],
  key: "A dorian",
  level: 1.26,
  voices: {
    vn1: line("o.vn", 0.54, SEAT.vn1, 0.3),
    fl: line("o.fl", 0.44, SEAT.fl, 0.34),
    hp: line("o.harp", 0.44, SEAT.harp, 0.3),
    va: chords("o.va", 0.12, SEAT.va, WET.strings, 55, 67, 2),
    vc: line("o.vc", 0.34, SEAT.vc, 0.24, bass("1 . . . . .", 36)),
    cbp: pulse("o.cb.pizz", 0.3, SEAT.cb, WET.low, bass("1 . . . . .", 28, 2)),
    waltz: pulse("o.vn.pizz", 0.24, SEAT.vn2, 0.24, bass("- - 10+12 - 10+12 -", 55)),
    drum: pulse("o.perc", 0.26, 0.1, 0.25, { kind: "drum", steps: "D.....", hits: { D: ["bd", 0.4] } }),
  },
  sections: {
    intro: { ...S.intro },
    A: { ...S.A },
    B: { ...S.B },
  },
  forms: [
    [
      { s: "intro", play: "waltz cbp", dyn: 0.55 },
      { s: "A", play: "mel:vn1 waltz vc cbp", dyn: 0.62 },
      { s: "B", play: "mel:vn1 waltz vc cbp va drum", dyn: 0.66 },
      { s: "B", play: "mel:vn1 desc:fl waltz vc cbp va drum", dyn: 0.7 },
      { s: "A", play: "mel:vn1 waltz vc cbp va drum", dyn: 0.66, rit: 0.88 },
    ],
    [
      { s: "A", play: "mel:hp waltz cbp", dyn: 0.6 },
      { s: "B", play: "mel:vn1 waltz vc cbp", dyn: 0.64 },
      { s: "B", play: "mel:vn1 desc:fl waltz vc cbp va drum", dyn: 0.68 },
      { s: "A", play: "mel:vn1 mel:hp-12 waltz vc cbp va drum", dyn: 0.66, rit: 0.88 },
    ],
  ],
  rest: [12, 22],
};
