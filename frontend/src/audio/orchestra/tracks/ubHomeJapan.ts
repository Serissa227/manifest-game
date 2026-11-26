// 《缘侧与潮声》管弦版（养成篇·家乡的日常——日本）：地方乐器领奏（两面筝、尺八、篠笛、拍子木、缔太鼓、太鼓——与合成版共用这些声部），
// 管弦只做衬底：中提琴极轻的空五度、大提琴组的根音长音、低音提琴拨奏（代替合成版的持续音与拨奏）。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { UB_HOME_JAPAN as SYNTH } from "../../tracks/ubHomeJapan";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const UB_HOME_JAPAN: TrackDef = {
  id: "ub_home_japan",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["koto", "kpat", "shaku", "fue", "hyo", "shime", "taiko"]),
    va: chords("o.va", 0.07, SEAT.va, 0.4, 55, 67, 2),
    vc: chords("o.vc", 0.1, SEAT.vc, WET.low, 43, 55, 1),
    cbp: pulse("o.cb.pizz", 0.16, SEAT.cb, WET.low, bass("1 . . . 5 . . .", 31, 3)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { dem: "va vc", pz: "cbp" }),
  rest: SYNTH.rest,
  level: SYNTH.level,
};
