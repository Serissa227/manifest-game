// 《社学的读书声》管弦版（学院的短主题·漳州的社学，C 宫五声，琴箫合奏）：地方乐器领奏（古琴的按音、走手音与泛音，箫——与合成版共用这些声部），
// 管弦只做衬底：大提琴组在最低处拉 C，中提琴与第二小提琴极轻的 C–G 空五度，散音处低音提琴与大提琴组拨奏一下。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { AC_ZHANGZHOU as SYNTH } from "../../tracks/acZhangzhou";
import { line, pick, retarget, SEAT, WET } from "./kit";

export const AC_ZHANGZHOU: TrackDef = {
  id: "ac_zhangzhou",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  space: SYNTH.space,
  voices: {
    ...pick(SYNTH.voices, ["qin", "zou", "fan", "xiao"]),
    vc: { inst: "o.vc", gain: 0.11, pan: SEAT.vc, reverb: WET.low, poly: true, pattern: { kind: "drone", notes: [36] } },
    va: { inst: "o.va", gain: 0.06, pan: SEAT.va, reverb: 0.44, poly: true, pattern: { kind: "drone", notes: [48, 55] } },
    vn: { inst: "o.vn", gain: 0.035, pan: SEAT.vn2, reverb: 0.5, poly: true, pattern: { kind: "drone", notes: [67, 72] } },
    cbp: line("o.cb.pizz", 0.16, SEAT.cb, WET.low),
    vcp: line("o.vc.pizz", 0.1, SEAT.vc, WET.low),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { bed: "vc va vn", thud: "cbp vcp" }),
  rest: SYNTH.rest,
  level: 1.3,
};
