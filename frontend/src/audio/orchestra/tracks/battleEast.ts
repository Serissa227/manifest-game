// 《海上的战鼓》管弦版（东亚的海上的海战，B 羽调式的五声，4/4）：东亚的乐器领奏
// （唢呐、琵琶、大锣、堂鼓、太鼓、铙钹、板鼓——与合成版共用这些声部），
// 管弦只做衬底：中提琴与大提琴极轻的空五度长音，低音提琴一个和弦一个长音。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { BATTLE_EAST as SYNTH } from "../../tracks/battleEast";
import { chords, pick, retarget, SEAT, WET } from "./kit";

export const BATTLE_EAST: TrackDef = {
  id: "battle_east",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.05,
  voices: {
    ...pick(SYNTH.voices, ["suona", "pipa", "daluo", "tg", "tk", "bo", "bangu"]),
    va: chords("o.va", 0.09, SEAT.va, 0.4, 54, 69, 2),
    vc: chords("o.vc", 0.08, SEAT.vc, 0.38, 42, 57, 2),
    cb: chords("o.cb", 0.16, SEAT.cb, WET.low, 30, 42, 1),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vc", low: "cb" }),
  rest: SYNTH.rest,
};
