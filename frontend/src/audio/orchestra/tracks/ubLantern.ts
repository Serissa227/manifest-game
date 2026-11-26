// 《上元灯市》管弦版（养成篇的节日·明，D 宫五声 4/4 的灯市）：地方乐器领奏（梆笛、唢呐、二胡、大笛、琵琶、云锣、扬琴、笙、
// 锣鼓与拍板——与合成版共用这些声部），管弦只做衬底：大提琴组与低音提琴拨奏走低音（代替合成版的拨奏），
// 笙奏长音的地方中提琴很轻地跟着同一组空五度。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { UB_LANTERN as SYNTH } from "../../tracks/ubLantern";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const UB_LANTERN: TrackDef = {
  id: "ub_lantern",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["di", "suona", "erhu", "dadi", "pipa", "yunluo", "yangqin", "sheng", "xiaoluo", "daluo", "bangu", "tanggu", "bo", "ban"]),
    vcp: pulse("o.vc.pizz", 0.24, SEAT.vc, WET.low, bass("1 . . . 5, . . .", 43, 2)),
    cbp: pulse("o.cb.pizz", 0.18, SEAT.cb, WET.low, bass("1 . . . . . . .", 26, 2)),
    va: chords("o.va", 0.07, SEAT.va, 0.4, 55, 69, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { bass: "vcp cbp", sheng: "sheng va" }),
  rest: SYNTH.rest,
  level: 1.1,
};
