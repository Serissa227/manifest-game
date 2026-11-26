// 《皮影戏的夜》管弦版（马来世界的港口的第二首，斯连德罗的五声，很慢的 4/4）：甘美兰的软合奏领奏
// （苏灵笛、雷巴布、斯连特姆的骨干旋律、根德尔、甘邦、西特琴、肯普尔、克农、大锣、肯当鼓——与合成版共用这些声部），
// 管弦只做衬底：中提琴与大提琴极轻的空五度长音。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_MALAY_NIGHT as SYNTH } from "../../tracks/portMalayNight";
import { chords, pick, retarget, SEAT } from "./kit";

export const PORT_MALAY_NIGHT: TrackDef = {
  id: "port_malay_night",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.15,
  space: SYNTH.space,
  voices: {
    ...pick(SYNTH.voices, ["sul", "reb", "slen", "gender", "gamb", "siter", "kempul", "kenong", "gong", "kend"]),
    va: chords("o.va", 0.07, SEAT.va, 0.44, 50, 64, 2),
    vc: chords("o.vc", 0.06, SEAT.vc, 0.42, 38, 52, 1),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { drone: "va vc" }),
  rest: SYNTH.rest,
};
