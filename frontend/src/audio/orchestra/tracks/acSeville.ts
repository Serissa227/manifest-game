// 《侯爵府的维韦拉》管弦版（学院的短主题·塔里法侯爵的府邸，D 小调慢 4/4 的帕凡舞）：第二阶段重编——
// 维韦拉琴、高音与低音维奥尔、极轻的塔博鼓（合成的地方乐器，与合成版共用这些声部）领奏，管弦只做衬底：
// 中提琴与大提琴组很轻的长音、低音提琴极轻的拨奏（代替合成版的弦乐群）。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { AC_SEVILLE as SYNTH } from "../../tracks/acSeville";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const AC_SEVILLE: TrackDef = {
  id: "ac_seville",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.42,
  voices: {
    ...pick(SYNTH.voices, ["vihuela", "arp", "viol", "bass", "drum"]),
    va: chords("o.va", 0.08, SEAT.va, WET.strings, 55, 67, 2),
    vc: line("o.vc", 0.1, SEAT.vc, WET.low, bass("1 . . . . . . .", 38, 8)),
    cbp: pulse("o.cb.pizz", 0.12, SEAT.cb, WET.low, bass("1 . . . . . . .", 38, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { strings: "va vc cbp" }),
  rest: SYNTH.rest,
};
