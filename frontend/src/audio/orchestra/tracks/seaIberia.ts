// 《圣文森特角的帆》管弦版（伊比利亚与大西洋沿岸，A 小调 6/8，安达卢西亚终止，六三交替）：第二阶段重编——
// 伊比利亚的乐器领奏（短号、维奥尔琴、竖笛、肖姆管、萨克布、维韦拉琴的扫弦、巴洪管、响板、阿杜菲方鼓——与合成版共用这些声部），
// 管弦只做衬底：第二小提琴与中提琴很轻的和弦长音，大提琴组与低音提琴拨奏落在第一、四拍。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_IBERIA as SYNTH } from "../../tracks/seaIberia";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_IBERIA: TrackDef = {
  id: "sea_iberia",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.14,
  voices: {
    ...pick(SYNTH.voices, ["cornett", "gamba", "recs", "reca", "shawm", "sackbut", "vstrum", "bajon", "cast", "adufe"]),
    vn2: chords("o.vn", 0.06, SEAT.vn2, 0.4, 64, 76, 2),
    va: chords("o.va", 0.08, SEAT.va, 0.4, 55, 67, 2),
    vcp: pulse("o.vc.pizz", 0.22, SEAT.vc, WET.low, bass("1 . . 5, . .", 45, 2)),
    cbp: pulse("o.cb.pizz", 0.16, SEAT.cb, WET.low, bass("1 . . 1 . .", 28, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "vn2 va", pz: "vcp cbp" }),
  rest: SYNTH.rest,
};
