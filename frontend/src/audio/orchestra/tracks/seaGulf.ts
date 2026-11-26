// 《采珠船》管弦版（阿拉伯的海，G 拉斯特，6/8）：阿拉伯的乐器领奏
// （乌德琴、西姆西米亚琴、奈伊笛、米兹玛尔、米尔瓦斯小鼓、拍手、陶罐——与合成版共用这些声部），
// 管弦只做衬底：大提琴与中提琴极轻的空五度长音，大提琴组与低音提琴的拨奏。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_GULF as SYNTH } from "../../tracks/seaGulf";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_GULF: TrackDef = {
  id: "sea_gulf",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.29,
  voices: {
    ...pick(SYNTH.voices, ["ud", "sims", "nay", "mizmar", "mirw", "clap", "jah"]),
    vc: chords("o.vc", 0.07, SEAT.vc, 0.4, 43, 57, 1),
    va: chords("o.va", 0.07, SEAT.va, 0.42, 50, 64, 2),
    vcp: pulse("o.vc.pizz", 0.17, SEAT.vc, WET.low, bass("1 . . 1 . .", 43, 2)),
    cbp: pulse("o.cb.pizz", 0.13, SEAT.cb, WET.low, bass("1 . . . . .", 31, 3)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { drone: "vc va", pz: "vcp cbp" }),
  rest: SYNTH.rest,
};
