// 《海峡的甘布斯》管弦版（马来世界的海，D 小调 4/4，扎宾舞）：海峡的乐器领奏
// （甘布斯、雷巴布、苏灵笛、马尔瓦斯小鼓、框鼓、吊锣——与合成版共用这些声部），
// 管弦只做衬底：大提琴与中提琴极轻的长音，大提琴组与低音提琴的拨奏。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_MALACCA as SYNTH } from "../../tracks/seaMalacca";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_MALACCA: TrackDef = {
  id: "sea_malacca",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.19,
  voices: {
    ...pick(SYNTH.voices, ["gam", "reb", "sul", "mar", "terb", "gong"]),
    vc: chords("o.vc", 0.07, SEAT.vc, 0.4, 38, 52, 1),
    va: chords("o.va", 0.07, SEAT.va, 0.42, 50, 65, 2),
    vcp: pulse("o.vc.pizz", 0.2, SEAT.vc, WET.low, bass("1 . . 1 . . 5 .", 38, 2)),
    cbp: pulse("o.cb.pizz", 0.15, SEAT.cb, WET.low, bass("1 . . . . . 1 .", 26, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { drone: "vc va", pz: "vcp cbp" }),
  rest: SYNTH.rest,
};
