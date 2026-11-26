// 《钦查的筏》管弦版（安第斯的太平洋沿岸，E 小调五声 4/4 的瓦伊诺）：安第斯的乐器领奏（盖那笛、轮吹的排箫（两套，各两排）、普图图海螺号、
// 恰朗戈、万卡拉大鼓、廷亚小鼓、羊蹄壳串——与合成版共用这些声部），管弦只做衬底：大提琴组与低音提琴拨奏走低音，
// B 段第二小提琴与中提琴很轻的和弦长音。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_ANDES as SYNTH } from "../../tracks/seaAndes";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_ANDES: TrackDef = {
  id: "sea_andes",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["quena", "ira", "arka", "ira_low", "arka_low", "pututu", "charango", "wankara", "tinya", "chajchas"]),
    vcp: pulse("o.vc.pizz", 0.18, SEAT.vc, WET.low, bass("1 . 5, . 1 . 5, .", 41, 2)),
    cbp: pulse("o.cb.pizz", 0.12, SEAT.cb, WET.low, bass("1 . . . 1 . . .", 28, 2)),
    vn2: chords("o.vn", 0.05, SEAT.vn2, WET.strings, 62, 74, 2),
    va: chords("o.va", 0.055, SEAT.va, WET.strings, 55, 67, 3),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { bass: "vcp cbp", strings: "vn2 va" }),
  rest: SYNTH.rest,
  level: 1.35,
};
