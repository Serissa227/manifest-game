// 《亚得里亚的帆影》管弦版（意大利与地中海，G 多利亚 4/4 的帕凡舞）：第二阶段重编——
// 文艺复兴的意大利乐器领奏（两把鲁特琴、维奥尔琴、短号、萨克布、高音竖笛、便携管风琴、簧管风琴、塔博鼓——与合成版共用这些声部），
// 管弦只做衬底：中提琴很轻的和弦长音、大提琴组的根音长音、低音提琴拨奏。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_MED as SYNTH } from "../../tracks/seaMed";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_MED: TrackDef = {
  id: "sea_med",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["liuto", "gamba", "cornett", "recs", "organ", "sackbut", "larp", "regal", "gbass", "taborin"]),
    va: chords("o.va", 0.09, SEAT.va, 0.4, 55, 67, 2),
    vc: line("o.vc", 0.12, SEAT.vc, WET.low, bass("1 . . . . . . .", 43, 8)),
    cbp: pulse("o.cb.pizz", 0.18, SEAT.cb, WET.low, bass("1 . . . . . . .", 31, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vc", pz: "cbp" }),
  rest: SYNTH.rest,
  level: 1.22,
};
