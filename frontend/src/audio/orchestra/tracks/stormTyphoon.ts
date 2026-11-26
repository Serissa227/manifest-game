// 《台风》管弦版（东亚的海上的暴风雨，A 羽调式的五声，4/4）：东亚的乐器领奏
// （唢呐、大笛、能管、琵琶的扫拂、大锣、堂鼓、太鼓、铙钹、板鼓——与合成版共用这些声部），
// 管弦只做衬底：小提琴组极轻的颤弓（风声）与低音提琴的长音。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { STORM_TYPHOON as SYNTH } from "../../tracks/stormTyphoon";
import { chords, pick, retarget, SEAT, WET } from "./kit";

export const STORM_TYPHOON: TrackDef = {
  id: "storm_typhoon",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.07,
  hall: true,
  voices: {
    ...pick(SYNTH.voices, ["suona", "dadi", "noh", "pipa", "daluo", "tg", "tk", "bo", "bangu"]),
    trem: chords("o.vn.trem", 0.1, SEAT.vn2, 0.4, 57, 76, 2),
    va: chords("o.va", 0.08, SEAT.va, 0.4, 52, 64, 2),
    cb: chords("o.cb", 0.16, SEAT.cb, WET.low, 33, 45, 1),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "trem va", low: "cb" }),
  rest: SYNTH.rest,
};
