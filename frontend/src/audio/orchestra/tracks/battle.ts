// 《黑帆》管弦版（遭遇海盗与海战，D 小调 6/8，每分钟 162 拍，不留白）：旋律与和声同合成版，按管弦乐重新配器。
// 大提琴组用跳弓奏不停的固定音型，低音提琴拨奏落在第一、四拍；定音鼓打主音与五音，大鼓打第一、四拍；
// 号角（起帆动机的空五度）由小号吹、圆号低八度同奏；A 段重复时小提琴组在上方三度加进来；
// B 段小提琴组用跳弓奔跑的八分音符、军鼓加密，圆号在下面拉长音，第二次长号的和弦与小提琴组的颤弓把张力推满。
import type { TrackDef } from "../../score";
import { BATTLE as SYNTH } from "../../tracks/battle";
import { bass, chords, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const BATTLE: TrackDef = {
  id: "battle",
  title: SYNTH.title,
  qpm: 162,
  meter: [6, 8],
  key: "D minor",
  level: 0.92,
  voices: {
    tp: line("o.tp", 0.5, SEAT.tp, WET.brass),
    hn: line("o.hn", 0.44, SEAT.hn, WET.brass),
    vn1: line("o.vn", 0.46, SEAT.vn1, 0.28),
    run: line("o.vn.spic", 0.52, SEAT.vn1, 0.26),
    ost: pulse("o.vc.spic", 0.38, SEAT.vc, 0.2, bass("1 1 8 1 5 1", 38)),
    cbp: pulse("o.cb.pizz", 0.26, SEAT.cb, WET.low, bass("1 . . 1 . .", 26, 2)),
    trem: chords("o.vn.trem", 0.12, SEAT.vn2, 0.36, 57, 72, 3),
    tb: chords("o.tb", 0.13, SEAT.tb, WET.brass, 45, 60, 3),
    timp: pulse("o.timp", 0.34, SEAT.timp, 0.3, bass("1 - - 5 - -", 38)),
    bd: pulse("o.perc", 0.22, 0.05, 0.3, { kind: "drum", steps: "T..t..", hits: { T: ["bd", 0.7], t: ["bd", 0.4] } }),
    snare: pulse("o.perc", 0.36, -0.15, 0.25, {
      a: { kind: "drum", steps: "..s..s", hits: { s: ["snare", 0.45] } },
      b: { kind: "drum", steps: "..s.ss", hits: { s: ["snare", 0.5] } },
    }),
    cymbal: pulse("o.perc", 0.22, 0.3, 0.4, { kind: "drum", steps: "C" + ".".repeat(47), hits: { C: ["crash", 0.66] } }),
  },
  sections: {
    intro: { ...S.intro },
    A: { ...S.A },
    B: { ...S.B },
  },
  forms: [
    [
      { s: "intro", play: "call:tp call:hn-12 bd timp", dyn: 0.72 },
      { s: "A", play: "mel:tp mel:hn-12 ost cbp trem timp bd", dyn: 0.72 },
      { s: "A", play: "mel:tp mel:hn-12 mel:vn1~2 ost cbp trem timp bd snare", dyn: 0.78 },
      { s: "B", play: "mel:run cnt:hn-12 ost cbp timp bd snare.b cymbal", dyn: 0.8 },
      { s: "B", play: "mel:run cnt:hn-12 ost cbp trem tb timp bd snare.b", dyn: 0.84 },
    ],
    [
      { s: "A", play: "mel:tp mel:hn-12 ost cbp timp bd", dyn: 0.72 },
      { s: "A", play: "mel:vn1 mel:tp~-2 ost cbp trem timp bd snare", dyn: 0.78 },
      { s: "B", play: "mel:run cnt:hn-12 ost cbp timp bd snare.b cymbal", dyn: 0.8 },
      { s: "B", play: "mel:run cnt:tp ost cbp trem tb timp bd snare.b", dyn: 0.84 },
    ],
  ],
  rest: [0, 0],
};
