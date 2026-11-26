// 《吉里的读经声》管弦版（学院的短主题·爪哇的吉里，F 上近似斯连德罗的五声 4/4）：地方特色第二阶段重编——
// 甘美兰的软合奏领奏（萨龙、斯连特姆、根德尔、甘邦、西特、苏灵笛、克图、克农、肯普尔、大锣、特尔班框鼓——与合成版共用这些声部），
// 管弦只做衬底：大提琴组与中提琴极轻的 F–C 长音，大提琴组拨奏轻轻跟着肯普尔、低音提琴拨奏跟着大锣。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { AC_GIRI as SYNTH } from "../../tracks/acGiri";
import { held, line, pick, retarget, SEAT, WET } from "./kit";

export const AC_GIRI: TrackDef = {
  id: "ac_giri",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.16,
  voices: {
    ...pick(SYNTH.voices, ["saron", "slenthem", "gender", "gambang", "siter", "suling", "kethuk", "kenong", "kempul", "gong", "terbang"]),
    vc: { ...held("o.vc", 0.1, SEAT.vc, WET.low), pattern: { kind: "drone", notes: [41, 48] } },
    va: { ...held("o.va", 0.06, SEAT.va, 0.44), pattern: { kind: "drone", notes: [60, 65] } },
    vcp: line("o.vc.pizz", 0.16, SEAT.vc, WET.low),
    cbp: line("o.cb.pizz", 0.2, SEAT.cb, WET.low),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "vc va", kempul: "kempul vcp", gong: "gong cbp" }),
  rest: SYNTH.rest,
};
