// 《东海的季风》管弦版（东海与黄海，D 宫五声 6/8）：地方乐器领奏（梆笛、琵琶、二胡、扬琴、云锣、笙、大锣、拍板与木鱼——
// 与合成版共用这些声部），管弦只做衬底：低音提琴与大提琴组拨奏落在第一、四拍（代替合成版的拨奏），笙奏长音的地方中提琴很轻地跟着。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
// 衬底的音量（10-11 复核）：和声改成空五度与挂留以后，第二遍衬底只比地方乐器低 6.9 dB，三个衬底声部各降 1 dB（0.22 / 0.22 / 0.07 → 0.196 / 0.196 / 0.062）。
import type { TrackDef } from "../../score";
import { SEA_EAST_CHINA as SYNTH } from "../../tracks/seaEastChina";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_EAST_CHINA: TrackDef = {
  id: "sea_east_china",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["di", "pipa", "erhu", "yq", "arp", "yunluo", "sheng", "gong", "clapper"]),
    cbp: pulse("o.cb.pizz", 0.196, SEAT.cb, WET.low, bass("1 . . 5 . .", 26, 2)),
    vcp: pulse("o.vc.pizz", 0.196, SEAT.vc, WET.low, bass("1 . . 5 . .", 38, 2)),
    va: chords("o.va", 0.062, SEAT.va, 0.4, 57, 69, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { bass: "cbp vcp", sheng: "sheng va" }),
  rest: SYNTH.rest,
  level: 1.23,
};
