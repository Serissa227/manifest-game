// 《月港的市声》管弦版：地方乐器领奏（梆笛、二胡、琵琶、箫、唢呐、扬琴、笙、锣鼓——与合成版共用这些声部），
// 管弦只做衬底：大提琴组与低音提琴拨奏走低音（代替合成版的拨奏），笙奏长音的地方中提琴很轻地跟着同一组挂留和弦。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
// 衬底的音量（10-11 东亚宫廷复核）：第一遍衬底只比地方乐器低 5.7 dB（第一阶段量的是 5.8 dB，也不到“低 7 dB”），
// 三个衬底声部降 1.2–1.9 dB（大提琴组拨奏 / 低音提琴拨奏 / 中提琴 0.26 / 0.16 / 0.08 → 0.22 / 0.14 / 0.064）。
import type { TrackDef } from "../../score";
import { PORT_MING as SYNTH } from "../../tracks/portMing";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_MING: TrackDef = {
  id: "port_ming",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["dizi", "erhu", "pipa", "xiao", "suona", "yangqin", "sheng", "xiaoluo", "daluo", "muyu", "bangu", "tanggu", "bo"]),
    vcp: pulse("o.vc.pizz", 0.22, SEAT.vc, WET.low, bass("1 . 5, . 1 . 5, .", 43, 2)),
    cbp: pulse("o.cb.pizz", 0.14, SEAT.cb, WET.low, bass("1 . . . . . . .", 31, 2)),
    va: chords("o.va", 0.064, SEAT.va, 0.4, 55, 69, 3),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { bass: "vcp cbp", sheng: "sheng va" }),
  rest: SYNTH.rest,
  level: 1.14,
};
