// 《胡椒与肉豆蔻的码头》管弦版：甘美兰领奏（萨龙、博南、根德尔、克农、肯普尔、大锣、苏灵笛、雷巴布、肯当鼓——与合成版共用这些声部），
// 管弦只做衬底：大提琴组与中提琴极轻的 E–B 长音垫在锣的下面（甘美兰本身没有和声，衬底只给一点空气），
// 大提琴组拨奏轻轻跟着肯普尔、低音提琴拨奏跟着大锣，给锣的循环一点“落地”的低音。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_MALAY as SYNTH } from "../../tracks/portMalay";
import { held, line, pick, retarget, SEAT, WET } from "./kit";

export const PORT_MALAY: TrackDef = {
  id: "port_malay",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["saron", "bonang1", "bonang2", "gender", "kenong", "kempul", "gong", "suling", "rebab", "kendang"]),
    vc: { ...held("o.vc", 0.1, SEAT.vc, WET.low), pattern: { kind: "drone", notes: [40, 47] } },
    va: { ...held("o.va", 0.06, SEAT.va, 0.44), pattern: { kind: "drone", notes: [59, 64] } },
    vcp: line("o.vc.pizz", 0.16, SEAT.vc, WET.low),
    cbp: line("o.cb.pizz", 0.2, SEAT.cb, WET.low),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "vc va", kempul: "kempul vcp", gong: "gong cbp" }),
  rest: SYNTH.rest,
  level: 1.3,
};
