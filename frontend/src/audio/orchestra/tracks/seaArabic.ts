// 《星与三角帆》管弦版（红海、亚丁湾、阿拉伯海与波斯湾；D 萨巴，阿尤布节奏）：
// 地方乐器领奏（乌德琴、奈伊笛、克曼切、卡农琴、达布卡、塔尔框鼓、里克鼓——与合成版共用这些声部），
// 管弦只做衬底：D–A 的持续音（引子与尾声）由大提琴组拉，空五度的长音是大提琴组与很轻的中提琴，大提琴组与低音提琴拨奏落在半小节上。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_ARABIC as SYNTH } from "../../tracks/seaArabic";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_ARABIC: TrackDef = {
  id: "sea_arabic",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["ud", "nay", "kemence", "kanun", "darbuka", "tari", "riq"]),
    pedal: { inst: "o.vc", gain: 0.14, pan: SEAT.vc, reverb: 0.3, poly: true, pattern: { kind: "drone", notes: [38, 45] } },
    vc: chords("o.vc", 0.1, SEAT.vc, WET.low, 38, 57, 2),
    va: chords("o.va", 0.07, SEAT.va, 0.4, 50, 64, 2),
    vcp: pulse("o.vc.pizz", 0.22, SEAT.vc, WET.low, bass("1 . . . 5, . . .", 50, 2)),
    cbp: pulse("o.cb.pizz", 0.17, SEAT.cb, WET.low, bass("1 . . . . . . .", 33, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { drone: "pedal", dem: "vc va", bass: "vcp cbp" }),
  rest: SYNTH.rest,
  level: 1.08,
};
