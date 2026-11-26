// 《渔火》管弦版（明的沿海与东海的夜，A 羽调式的五声，慢 4/4）：明的乐器领奏
// （箫、埙、二胡、古筝的刮奏与“流水”、琵琶的分解——与合成版共用这些声部），
// 管弦只做衬底：大提琴与中提琴极轻的长音，大提琴组与低音提琴的拨奏。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_LANTERNS as SYNTH } from "../../tracks/seaLanterns";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_LANTERNS: TrackDef = {
  id: "sea_lanterns",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.22,
  space: SYNTH.space,
  voices: {
    ...pick(SYNTH.voices, ["xiao", "xun", "erhu", "gz", "pp"]),
    vc: chords("o.vc", 0.07, SEAT.vc, 0.42, 45, 57, 1),
    va: chords("o.va", 0.07, SEAT.va, 0.44, 52, 67, 2),
    vcp: pulse("o.vc.pizz", 0.2, SEAT.vc, WET.low, bass("1 . . . 5 . . .", 45, 3)),
    cbp: pulse("o.cb.pizz", 0.15, SEAT.cb, WET.low, bass("1 . . . . . . .", 33, 4)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { drone: "vc va", pz: "vcp cbp" }),
  rest: SYNTH.rest,
};
