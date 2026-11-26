// 《茶楼丝竹》管弦版（明的港口与城市的第二首，G 宫的五声，4/4）：丝竹领奏
// （曲笛、二胡、古筝、扬琴、琵琶的分解、笙的长音、拍板与板鼓——与合成版共用这些声部），
// 管弦只做衬底：中提琴与大提琴极轻的长音，大提琴组与低音提琴的拨奏。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_MING_TEA as SYNTH } from "../../tracks/portMingTea";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_MING_TEA: TrackDef = {
  id: "port_ming_tea",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.2,
  voices: {
    ...pick(SYNTH.voices, ["qudi", "erhu", "gz", "yq", "pp", "sheng", "ban"]),
    va: chords("o.va", 0.06, SEAT.va, 0.42, 55, 67, 2),
    vc: chords("o.vc", 0.05, SEAT.vc, 0.4, 43, 55, 1),
    vcp: pulse("o.vc.pizz", 0.2, SEAT.vc, WET.low, bass("1 . . . 5 . . .", 43, 2)),
    cbp: pulse("o.cb.pizz", 0.15, SEAT.cb, WET.low, bass("1 . . . . . . .", 31, 3)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vc", pz: "vcp cbp" }),
  rest: SYNTH.rest,
};
