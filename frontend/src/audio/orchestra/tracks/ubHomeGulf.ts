// 《椰枣林的井》管弦版（养成篇·家乡的日常——阿拉伯的海湾）：地方乐器领奏（乌德琴、西姆西米亚琴、米兹玛尔、米尔瓦斯小鼓、拍手、陶罐——与合成版共用这些声部），
// 合成版的提琴换成真的小提琴（海湾的“骚特”里本来就有竖拉的提琴）；管弦的衬底只有中提琴极轻的空五度、大提琴组的根音长音与低音提琴的拨奏。
// 曲式、段落与合成版一模一样（retarget 只换提琴与衬底的声部）。
import type { TrackDef } from "../../score";
import { UB_HOME_GULF as SYNTH } from "../../tracks/ubHomeGulf";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const UB_HOME_GULF: TrackDef = {
  id: "ub_home_gulf",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["ud", "sims", "mizmar", "mirwas", "claps", "jahlah"]),
    vn: line("o.vn", 0.36, SEAT.vn1, WET.strings),
    va: chords("o.va", 0.07, SEAT.va, 0.4, 55, 67, 2),
    vc: chords("o.vc", 0.1, SEAT.vc, WET.low, 43, 55, 1),
    cbp: pulse("o.cb.pizz", 0.18, SEAT.cb, WET.low, bass("1 . . . 5 . . .", 31, 3)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { fid: "vn", dem: "va vc", pz: "cbp" }),
  rest: SYNTH.rest,
  level: SYNTH.level,
};
