// 《白墙巷的午后》管弦版（养成篇·家乡的日常——伊比利亚）：地方乐器领奏（维韦拉琴、中音竖笛、维奥尔琴、阿杜菲方鼓、响板——与合成版共用这些声部），
// 管弦只做衬底：中提琴很轻的和弦长音、大提琴组的根音长音、低音提琴拨奏落在每小节的第一拍。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { UB_HOME_IBERIA as SYNTH } from "../../tracks/ubHomeIberia";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const UB_HOME_IBERIA: TrackDef = {
  id: "ub_home_iberia",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["vih", "varp", "vstrum", "reca", "gamba", "adufe", "cast"]),
    va: chords("o.va", 0.08, SEAT.va, 0.4, 55, 67, 2),
    vc: line("o.vc", 0.11, SEAT.vc, WET.low, bass("1 . . . . .", 43, 6)),
    cbp: pulse("o.cb.pizz", 0.2, SEAT.cb, WET.low, bass("1 . . 5, . .", 31, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vc", pz: "cbp" }),
  rest: SYNTH.rest,
  level: SYNTH.level,
};
