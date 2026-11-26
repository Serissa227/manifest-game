// 《达乌船的归期》管弦版（斯瓦希里海岸的海，G 混合利底亚，12/8）：海岸的乐器领奏
// （乌德琴、卡农琴、祖马里、拇指琴的固定音型、恩戈马鼓、卡亚姆巴沙箱、塔里框鼓——与合成版共用这些声部），
// 管弦只做衬底：第二小提琴与中提琴很轻的和弦长音，大提琴组与低音提琴的拨奏。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_SWAHILI as SYNTH } from "../../tracks/seaSwahili";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_SWAHILI: TrackDef = {
  id: "sea_swahili",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.22,
  voices: {
    ...pick(SYNTH.voices, ["ud", "kanun", "zum", "kal", "ngoma", "kay", "tari"]),
    vn2: chords("o.vn", 0.06, SEAT.vn2, 0.4, 62, 76, 2),
    va: chords("o.va", 0.08, SEAT.va, 0.4, 53, 67, 2),
    vcp: pulse("o.vc.pizz", 0.2, SEAT.vc, WET.low, bass("1 . . . . . 5 . . 1 . .", 43, 3)),
    cbp: pulse("o.cb.pizz", 0.15, SEAT.cb, WET.low, bass("1 . . . . . 1 . . . . .", 31, 3)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "vn2 va", pz: "vcp cbp" }),
  rest: SYNTH.rest,
};
