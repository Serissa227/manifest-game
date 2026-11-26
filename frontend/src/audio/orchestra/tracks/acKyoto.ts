// 《宫中的筝》管弦版（学院的短主题·京都，E 平调的雅乐，慢 4/4）：地方乐器领奏（筚篥、龙笛、笙、乐琵琶、乐筝、钲鼓、羯鼓、钓太鼓——
// 与合成版共用这些声部），管弦只做衬底：大提琴组在最低处拉 E（第二段换到 A），中提琴极轻的空五度，第二小提琴在高处更轻的空五度，
// 周期末尾低音提琴拨奏跟着钓太鼓的“咚”。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
// 衬底的音量（10-11 复核）：第二遍的残乐里地方乐器变稀，衬底只低 6.9 dB，四个衬底声部各降 1 dB（0.13 / 0.07 / 0.04 / 0.2 → 0.116 / 0.062 / 0.036 / 0.178）。
import type { TrackDef } from "../../score";
import { AC_KYOTO as SYNTH } from "../../tracks/acKyoto";
import { line, pick, retarget, SEAT, WET } from "./kit";

export const AC_KYOTO: TrackDef = {
  id: "ac_kyoto",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  space: SYNTH.space,
  voices: {
    ...pick(SYNTH.voices, ["hichi", "fue", "sho", "biwa", "so", "shoko", "kakko", "taiko"]),
    vc: { inst: "o.vc", gain: 0.116, pan: SEAT.vc, reverb: WET.low, poly: true, pattern: { a: { kind: "drone", notes: [40] }, b: { kind: "drone", notes: [45] } } },
    va: { inst: "o.va", gain: 0.062, pan: SEAT.va, reverb: 0.44, poly: true, pattern: { a: { kind: "drone", notes: [52, 59] }, b: { kind: "drone", notes: [57, 64] } } },
    vn: { inst: "o.vn", gain: 0.036, pan: SEAT.vn2, reverb: 0.5, poly: true, pattern: { a: { kind: "drone", notes: [71, 76] }, b: { kind: "drone", notes: [69, 76] } } },
    cbp: line("o.cb.pizz", 0.178, SEAT.cb, WET.low),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { bed: "vc va vn", thud: "cbp" }),
  rest: SYNTH.rest,
  level: 1.38,
};
