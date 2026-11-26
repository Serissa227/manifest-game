// 《第勒尼安的夏夜》管弦版（地中海的西半边，D 小调的慢 6/8，西西里舞曲的摇荡）：意大利的乐器领奏
// （中音竖笛、短号、维奥尔琴、便携管风琴、鲁特琴的分解和弦、簧管风琴的长音、意大利铃鼓——与合成版共用这些声部），
// 管弦只做衬底：第二小提琴与中提琴很轻的和弦长音，大提琴组与低音提琴拨奏落在第一、四拍。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_TYRRHENIAN as SYNTH } from "../../tracks/seaTyrrhenian";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_TYRRHENIAN: TrackDef = {
  id: "sea_tyrrhenian",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.26,
  space: SYNTH.space,
  voices: {
    ...pick(SYNTH.voices, ["reca", "cornett", "gamba", "org", "larp", "regal", "tamb"]),
    vn2: chords("o.vn", 0.06, SEAT.vn2, 0.42, 64, 76, 2),
    va: chords("o.va", 0.08, SEAT.va, 0.42, 55, 67, 2),
    vcp: pulse("o.vc.pizz", 0.2, SEAT.vc, WET.low, bass("1 . . 5, . .", 45, 2)),
    cbp: pulse("o.cb.pizz", 0.15, SEAT.cb, WET.low, bass("1 . . 1 . .", 28, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "vn2 va", pz: "vcp cbp" }),
  rest: SYNTH.rest,
};
