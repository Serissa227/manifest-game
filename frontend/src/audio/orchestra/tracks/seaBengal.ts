// 《恒河口的船歌》管弦版（印度沿岸的海，D 卡菲，7/8 的鲁帕克）：印度的乐器领奏
// （班苏里笛、萨朗吉、多塔拉、坦布拉、塔布拉——与合成版共用这些声部），
// 管弦只做衬底：第二小提琴与中提琴极轻的空五度长音，大提琴组与低音提琴的拨奏。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_BENGAL as SYNTH } from "../../tracks/seaBengal";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_BENGAL: TrackDef = {
  id: "sea_bengal",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.08,
  space: SYNTH.space,
  voices: {
    ...pick(SYNTH.voices, ["bans", "sar", "dot", "tanp", "tabr", "tabl"]),
    vn2: chords("o.vn", 0.05, SEAT.vn2, 0.44, 62, 74, 2),
    va: chords("o.va", 0.07, SEAT.va, 0.44, 50, 64, 2),
    vcp: pulse("o.vc.pizz", 0.18, SEAT.vc, WET.low, bass("1 . . 1 . 5 .", 38, 2)),
    cbp: pulse("o.cb.pizz", 0.14, SEAT.cb, WET.low, bass("1 . . . . . .", 26, 3)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "vn2 va", pz: "vcp cbp" }),
  rest: SYNTH.rest,
};
