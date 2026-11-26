// 《驼铃与海风》管弦版（沙漠海岸与南方海路，D 希贾兹，6/8）：旋律与和声同合成版，按管弦乐重新配器。
// 希贾兹的增二度（降 E 到升 F）交给双簧管唱——双簧管的鼻音最像沙漠里的芦笛；乌德琴的领奏改成小提琴组拨奏与竖琴同奏（弹拨的颗粒感），
// 低八度的重复交给大管；竖琴弹卡农琴的分解和弦，大提琴组与低音提琴拨奏落在第一、四拍；
// 达布卡鼓的“咚 · 嗒 咚 卡 嗒”改成轻轻的大鼓（咚）与铃鼓（嗒、卡），铃鼓在第三、六拍摇；远处商队的驼铃是钟琴。
// D 与 A 的持续音只在前奏与尾声（大提琴组）；B 段离岸之后海面开阔，中提琴与第二小提琴的和弦长音铺开。
import type { TrackDef } from "../../score";
import { SEA_SOUTH as SYNTH } from "../../tracks/seaSouth";
import { bass, chords, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const SEA_SOUTH: TrackDef = {
  id: "sea_south",
  title: SYNTH.title,
  qpm: 100,
  meter: [6, 8],
  key: "D hijaz",
  voices: {
    ob: line("o.ob", 0.56, SEAT.ob, WET.winds),
    fl: line("o.fl", 0.46, SEAT.fl, WET.winds),
    bn: line("o.bn", 0.5, SEAT.bn, WET.winds),
    // “乌德琴”：小提琴组拨奏与竖琴同奏
    pz: line("o.vn.pizz", 0.5, SEAT.vn1, 0.26),
    hp: line("o.harp", 0.36, SEAT.harp, 0.3),
    harp: pulse("o.harp", 0.24, SEAT.harp, WET.harp, { kind: "arp", low: 50, steps: "1 5 8 5 12 8", ring: 2 }),
    vn2: chords("o.vn", 0.13, SEAT.vn2, WET.strings, 62, 74, 2),
    va: chords("o.va", 0.12, SEAT.va, WET.strings, 55, 67, 2),
    drone: { inst: "o.vc", gain: 0.2, pan: SEAT.vc, reverb: 0.26, poly: true, pattern: { kind: "drone", notes: [38, 45] } },
    vcp: pulse("o.vc.pizz", 0.4, SEAT.vc, WET.low, bass("1 . . 5 . .", 38, 2)),
    cbp: pulse("o.cb.pizz", 0.32, SEAT.cb, WET.low, bass("1 . . 1 . .", 26, 2)),
    perc: pulse("o.perc", 0.34, SEAT.perc, WET.perc, {
      kind: "drum",
      steps: "D.TDkT",
      hits: { D: ["bd", 0.34], T: ["tamb", 0.34], k: ["shake", 0.24] },
    }),
    riq: pulse("o.perc", 0.26, -0.3, WET.perc, { kind: "drum", steps: "..r..r", hits: { r: ["shake", 0.36] } }),
    glock: line("o.glock", 0.14, 0.45, 0.55),
  },
  sections: {
    intro: { ...S.intro },
    A: { ...S.A },
    B: { ...S.B },
    outro: { ...S.outro },
  },
  forms: [
    [
      { s: "intro", play: "motif:ob bells:glock drone perc", dyn: 0.55, to: 0.64 },
      { s: "A", play: "mel:pz mel:hp vcp cbp perc harp", dyn: 0.66 },
      { s: "A", play: "mel:ob mel:bn-12 harp vcp cbp perc riq", dyn: 0.68 },
      { s: "B", play: "mel:ob vn2 va harp vcp cbp perc riq", dyn: 0.68, to: 0.74 },
      { s: "B", play: "mel:pz mel:hp mel:fl harp vn2 va vcp cbp perc riq", dyn: 0.74 },
      { s: "A", play: "mel:ob mel:pz harp vcp cbp perc riq", dyn: 0.72 },
      { s: "outro", play: "tag:ob bells:glock drone vcp cbp", dyn: 0.6, to: 0.4, rit: 0.85 },
    ],
    [
      { s: "intro", play: "motif:fl drone", dyn: 0.52, to: 0.6 },
      { s: "A", play: "mel:fl harp vcp cbp perc", dyn: 0.64 },
      { s: "A", play: "mel:pz mel:hp harp vcp cbp perc riq", dyn: 0.68 },
      { s: "B", play: "mel:bn-12 va harp vcp cbp perc", dyn: 0.66, to: 0.72 },
      { s: "B", play: "mel:ob mel:bn-12 harp vn2 va vcp cbp perc riq", dyn: 0.72 },
      { s: "A", play: "mel:ob mel:pz harp vcp cbp perc riq", dyn: 0.72 },
      { s: "outro", play: "tag:fl bells:glock drone vcp cbp", dyn: 0.58, to: 0.38, rit: 0.85 },
    ],
  ],
  rest: [25, 45],
};
