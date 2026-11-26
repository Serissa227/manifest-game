// 《泰晤士河的号笛舞》管弦版：地方乐器领奏（三孔笛与小鼓、雷贝克琴、班多拉琴、塔楼的鸣钟——与合成版共用这些声部），
// 管弦只做衬底：中提琴与第二小提琴很轻的和弦长音（像远处的维奥尔琴合奏），大提琴组拉根音、低音提琴拨奏落在每小节第一拍。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_ENGLAND as SYNTH } from "../../tracks/portEngland";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_ENGLAND: TrackDef = {
  id: "port_england",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["pipe", "rebeck", "bandora", "bells", "tabor"]),
    vc: line("o.vc", 0.14, SEAT.vc, WET.low, bass("1 . . . . . . . . . . .", 38, 12)),
    cbp: pulse("o.cb.pizz", 0.15, SEAT.cb, WET.low, bass("1 . . . . . . . 5 . . .", 33, 2)),
    va: chords("o.va", 0.09, SEAT.va, 0.4, 52, 67, 2),
    vn: chords("o.vn", 0.06, SEAT.vn2, 0.44, 62, 76, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vn", low: "vc cbp" }),
  rest: SYNTH.rest,
  level: 1.05,
};
