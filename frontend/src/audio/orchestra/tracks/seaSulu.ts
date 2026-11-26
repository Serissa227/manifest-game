// 《苏禄海的锣》管弦版：库林唐锣乐领奏（库林唐、阿贡、甘丁甘、库迪亚皮、苏灵笛、达巴坎、巴本迪尔——与合成版共用这些声部），
// 管弦只做衬底：大提琴组与中提琴极轻的 E–B 长音，高处小提琴更轻的 B–E 像海上的雾，低音提琴拨奏轻轻跟着阿贡。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_SULU as SYNTH } from "../../tracks/seaSulu";
import { held, line, pick, retarget, SEAT, WET } from "./kit";

export const SEA_SULU: TrackDef = {
  id: "sea_sulu",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.36,
  voices: {
    ...pick(SYNTH.voices, ["kul", "agung", "gand", "kud", "suling", "dabakan", "babendil"]),
    // 复查：第二遍里衬底只比地方乐器低 6.9 dB，大提琴组、中提琴与拨奏各再压轻一点（两遍都低 7 dB 以上，见 docs/DECISIONS.md）
    vc: { ...held("o.vc", 0.09, SEAT.vc, WET.low), pattern: { kind: "drone", notes: [40, 47] } },
    va: { ...held("o.va", 0.055, SEAT.va, 0.46), pattern: { kind: "drone", notes: [59, 64] } },
    vn: { ...held("o.vn", 0.035, SEAT.vn2, 0.52), pattern: { kind: "drone", notes: [71, 76] } },
    cbp: line("o.cb.pizz", 0.12, SEAT.cb, WET.low),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "vc va vn", agung: "agung cbp" }),
  rest: SYNTH.rest,
};
