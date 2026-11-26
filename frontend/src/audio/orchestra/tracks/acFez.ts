// 《卡拉维因的芦笛》管弦版（学院的短主题·非斯，A 弗里吉亚 6/8，安达卢西亚努巴的颜色）。
// 地方特色第二阶段重编：地方乐器领奏（奈伊笛、乌德琴、拉巴卜、卡农琴、达布卡、小框鼓——与合成版共用这些声部），
// 管弦只做衬底：中提琴与大提琴组很轻的空五度长音（跟着根音走），大提琴组与低音提琴拨奏落在“咚”与第四拍上。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { AC_FEZ as SYNTH } from "../../tracks/acFez";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const AC_FEZ: TrackDef = {
  id: "ac_fez",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.22,
  voices: {
    ...pick(SYNTH.voices, ["nay", "ud", "rabab", "kanun", "darb", "tar"]),
    va: chords("o.va", 0.08, SEAT.va, WET.strings, 52, 69, 2),
    vc: chords("o.vc", 0.08, SEAT.vc, WET.low, 40, 57, 2),
    vcp: pulse("o.vc.pizz", 0.24, SEAT.vc, WET.low, bass("1 . . 5, . .", 41, 2)),
    cbp: pulse("o.cb.pizz", 0.16, SEAT.cb, WET.low, bass("1 . . 1 . .", 28, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { dem: "va vc", bass: "vcp cbp" }),
  rest: SYNTH.rest,
};
