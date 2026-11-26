// 《海峡的西风》管弦版（北海与英吉利海峡，E 多利亚，9/8 的滑步吉格）：海峡两岸的乐器领奏
// （雷贝克琴、三孔笛、手摇弦琴与它的持续音弦、班多拉琴、小鼓——与合成版共用这些声部），
// 管弦只做衬底：第二小提琴与中提琴很轻的和弦长音，大提琴组与低音提琴的拨奏。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_CHANNEL as SYNTH } from "../../tracks/seaChannel";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_CHANNEL: TrackDef = {
  id: "sea_channel",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.11,
  voices: {
    ...pick(SYNTH.voices, ["reb", "pipe", "hg", "hd", "band", "tab"]),
    vn2: chords("o.vn", 0.06, SEAT.vn2, 0.4, 62, 76, 2),
    va: chords("o.va", 0.08, SEAT.va, 0.4, 52, 67, 2),
    vcp: pulse("o.vc.pizz", 0.2, SEAT.vc, WET.low, bass("1 . . 5, . . 1 . .", 45, 2)),
    cbp: pulse("o.cb.pizz", 0.15, SEAT.cb, WET.low, bass("1 . . . . . 1 . .", 28, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "vn2 va", pz: "vcp cbp" }),
  rest: SYNTH.rest,
};
