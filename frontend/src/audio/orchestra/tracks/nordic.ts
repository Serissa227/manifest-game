// 《峡湾炉火》管弦版（诺德海姆公国的港口，北地风；E 小调 3/4 的波尔斯卡舞曲，第二拍略早、第三拍略晚）：旋律与和声同合成版，按管弦乐重新配器。
// 小提琴组领奏；底下大提琴组与低音提琴守着 E 与 B 的持续音；竖琴代替卡恩特勒琴弹分解和弦，第二遍开头由竖琴自己弹旋律；
// 大提琴组每小节一个长音走低音，大鼓在第一、三拍轻轻地“跺脚”；最后一段双簧管与小提琴同度，像炉火边大家一起跟着唱。
import type { TrackDef } from "../../score";
import { NORDIC as SYNTH } from "../../tracks/nordic";
import { bass, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const NORDIC: TrackDef = {
  id: "port_nordic",
  title: SYNTH.title,
  qpm: 104,
  meter: [3, 4],
  key: "E minor",
  groove: SYNTH.groove,
  level: 1.2,
  voices: {
    vn1: line("o.vn", 0.54, SEAT.vn1, 0.3),
    ob: line("o.ob", 0.4, SEAT.ob, 0.3),
    hp: line("o.harp", 0.42, SEAT.harp, 0.32),
    harp: pulse("o.harp", 0.24, SEAT.harp, WET.harp, { kind: "arp", low: 52, steps: "1 5 8 5 10 5", ring: 2 }),
    drone: { inst: "o.vc", gain: 0.2, pan: SEAT.vc, reverb: 0.26, poly: true, pattern: { kind: "drone", notes: [40, 47] } },
    cb: { inst: "o.cb", gain: 0.18, pan: SEAT.cb, reverb: 0.22, poly: true, pattern: { kind: "drone", notes: [28] } },
    vc: line("o.vc", 0.36, SEAT.vc, 0.24, bass("1 . . . . .", 36)),
    stomp: pulse("o.perc", 0.3, 0, 0.3, { kind: "drum", steps: "S...s.", hits: { S: ["bd", 0.5], s: ["bd", 0.3] } }),
  },
  sections: {
    intro: { ...S.intro },
    A: { ...S.A },
    B: { ...S.B },
  },
  forms: [
    [
      { s: "intro", play: "drone cb stomp", dyn: 0.6 },
      { s: "A", play: "mel:vn1 drone cb stomp", dyn: 0.66 },
      { s: "A", play: "mel:vn1 harp vc stomp", dyn: 0.7 },
      { s: "B", play: "mel:vn1 harp vc stomp", dyn: 0.72 },
      { s: "B", play: "mel:vn1 mel:ob harp vc drone stomp", dyn: 0.76, rit: 0.9 },
    ],
    [
      { s: "A", play: "mel:hp drone cb", dyn: 0.6 },
      { s: "A", play: "mel:vn1 harp vc stomp", dyn: 0.68 },
      { s: "B", play: "mel:vn1 harp vc stomp", dyn: 0.72 },
      { s: "B", play: "mel:vn1 mel:hp-12 harp vc drone stomp", dyn: 0.76, rit: 0.9 },
    ],
  ],
  rest: [10, 18],
};
