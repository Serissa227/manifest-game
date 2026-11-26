// 《运河边的晾衣绳》管弦版（养成篇·家乡的日常——低地国家）：地方乐器领奏（维金纳琴、钟楼的排钟、两支克鲁姆管、雷贝克琴——与合成版共用这些声部），
// 管弦只做衬底：中提琴很轻的和弦长音、大提琴组的根音长音、低音提琴拨奏落在第一、三拍。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { UB_HOME_LOWLANDS as SYNTH } from "../../tracks/ubHomeLowlands";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const UB_HOME_LOWLANDS: TrackDef = {
  id: "ub_home_lowlands",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["virg", "vl", "bells", "crum", "crum2", "rebeck"]),
    va: chords("o.va", 0.08, SEAT.va, 0.4, 55, 67, 2),
    vc: line("o.vc", 0.11, SEAT.vc, WET.low, bass("1 . . . . . . .", 43, 8)),
    cbp: pulse("o.cb.pizz", 0.2, SEAT.cb, WET.low, bass("1 . . . 5, . . .", 31, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vc", pz: "cbp" }),
  rest: SYNTH.rest,
  level: SYNTH.level,
};
