// 《月桂树下的歌》管弦版（学院的短主题·安特卫普，F 大调 4/4 的尚松）：地方特色第二阶段重编——
// 地方乐器领奏（维金纳琴的旋律与分解和弦、钟楼的排钟、克鲁姆管的中低声部——与合成版共用这些声部），
// 管弦只做衬底：中提琴与第二小提琴很轻的和弦长音，大提琴组在低处一小节一个长音。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { AC_ANTWERP as SYNTH } from "../../tracks/acAntwerp";
import { bass, chords, line, pick, retarget, SEAT, WET } from "./kit";

export const AC_ANTWERP: TrackDef = {
  id: "ac_antwerp",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["virg", "virgarp", "bells", "crum", "crumb"]),
    va: chords("o.va", 0.054, SEAT.va, 0.4, 53, 67, 3),
    vn: chords("o.vn", 0.034, SEAT.vn2, 0.44, 65, 79, 2),
    vc: line("o.vc", 0.067, SEAT.vc, WET.low, bass("1 . . . . . . .", 41, 8)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vn vc" }),
  rest: SYNTH.rest,
  level: 1.74,
};
