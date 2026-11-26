// 《码头上的布雷舞》管弦版：地方乐器领奏（手摇弦琴与它的持续音弦、“狗”、法兰西风笛、加卢贝笛与普罗旺斯长鼓——与合成版共用这些声部），
// 管弦只做衬底：大提琴组在低处拉 G 的长音、低音提琴拨奏落在每一步的第一拍，中提琴极轻的 G–D 空五度。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_FRANCE as SYNTH } from "../../tracks/portFrance";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_FRANCE: TrackDef = {
  id: "port_france",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["vielle", "bourdon", "chien", "muse", "galou", "tamb"]),
    vc: line("o.vc", 0.12, SEAT.vc, WET.low, bass("1 . . . . .", 43, 6)),
    cbp: pulse("o.cb.pizz", 0.13, SEAT.cb, WET.low, bass("1 . . 5 . .", 31, 2)),
    va: chords("o.va", 0.064, SEAT.va, 0.42, 50, 67, 3),
    vn: chords("o.vn", 0.04, SEAT.vn2, 0.46, 67, 79, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vn", low: "vc cbp" }),
  rest: SYNTH.rest,
  level: 1.16,
};
