// 《香料之路》管弦版（卡迪尔苏丹国的港口，沙漠风；D 上的巴亚提木卡姆，第二级 E 降四分之一音；4/4 的马克苏姆节奏）：
// 旋律与和声同合成版，按管弦乐重新配器。采样器按播放速率移调，四分之一音照样奏得出来。
// 乌德琴的领奏改成小提琴组拨奏与竖琴同奏；奈伊笛改成长笛的低音区（气声重）；B 段转到希贾兹时双簧管接过来；
// D 与 A 的持续音由中提琴组拉着（大提琴组在低八度），大提琴组与低音提琴拨奏走低音，竖琴弹卡农琴的分解和弦；
// 达布卡鼓的“咚 嗒 · 嗒 咚 · 嗒 ·”改成轻轻的大鼓与铃鼓，另一面铃鼓摇着走。
import type { TrackDef } from "../../score";
import { DESERT as SYNTH } from "../../tracks/desert";
import { bass, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const DESERT: TrackDef = {
  id: "port_desert",
  title: SYNTH.title,
  qpm: 92,
  meter: [4, 4],
  key: "D bayati",
  level: 0.84,
  voices: {
    pz: line("o.vn.pizz", 0.5, SEAT.vn1, 0.26),
    hp: line("o.harp", 0.36, SEAT.harp, 0.28),
    fl: line("o.fl", 0.54, SEAT.fl, 0.34),
    ob: line("o.ob", 0.5, SEAT.ob, 0.32),
    cl: line("o.cl", 0.44, SEAT.cl, 0.32),
    qanun: pulse("o.harp", 0.22, SEAT.harp + 0.1, WET.harp, { kind: "arp", low: 50, steps: "1 5 8 5 12 8 5 8", ring: 2 }),
    drone: { inst: "o.va", gain: 0.16, pan: SEAT.va, reverb: 0.3, poly: true, pattern: { kind: "drone", notes: [50, 57] } },
    low: { inst: "o.vc", gain: 0.16, pan: SEAT.vc, reverb: 0.26, poly: true, pattern: { kind: "drone", notes: [38, 45] } },
    bass: pulse("o.vc.pizz", 0.42, SEAT.vc, WET.low, bass("1 . . . 1 . . .", 38, 2)),
    cbp: pulse("o.cb.pizz", 0.3, SEAT.cb, WET.low, bass("1 . . . 1 . . .", 26, 2)),
    darbuka: pulse("o.perc", 0.34, 0.1, 0.22, {
      a: { kind: "drum", steps: "DT.TD.T.", hits: { D: ["bd", 0.4], T: ["tamb", 0.4] } },
      b: { kind: "drum", steps: "DTkTD.Tk", hits: { D: ["bd", 0.4], T: ["tamb", 0.4], k: ["shake", 0.26] } },
    }),
    riq: pulse("o.perc", 0.26, -0.3, 0.22, { kind: "drum", steps: ".r.r.rr.", hits: { r: ["shake", 0.34] } }),
  },
  sections: {
    intro: { ...S.intro },
    A: { ...S.A },
    B: { ...S.B },
  },
  forms: [
    [
      { s: "intro", play: "drone low darbuka", dyn: 0.62 },
      { s: "A", play: "mel:pz mel:hp drone bass cbp darbuka", dyn: 0.66 },
      { s: "A", play: "mel:fl drone bass cbp darbuka riq", dyn: 0.68 },
      { s: "B", play: "mel:ob mel:pz qanun drone bass cbp darbuka.b riq", dyn: 0.74 },
      { s: "A", play: "mel:pz mel:hp mel:fl drone low bass cbp darbuka riq", dyn: 0.72, rit: 0.9 },
    ],
    [
      { s: "A", play: "mel:fl drone low", dyn: 0.6 },
      { s: "A", play: "mel:pz mel:hp drone bass cbp darbuka", dyn: 0.68 },
      { s: "B", play: "mel:ob qanun drone bass cbp darbuka.b riq", dyn: 0.72 },
      { s: "A", play: "mel:fl mel:cl-12 drone bass cbp darbuka riq", dyn: 0.72, rit: 0.9 },
    ],
  ],
  rest: [10, 20],
};
