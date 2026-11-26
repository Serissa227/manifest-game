// 《星路》管弦版（远洋的太平洋，C 利底亚慢 4/4，空、阔、安静）：太平洋的乐器领奏（鼻笛、普、乌克克口弓、贝伦巴奥图延葫芦弓、
// 帕胡鼓、卡拉阿乌节奏棒、加拉穆特裂缝锣——与合成版共用这些声部），管弦只做衬底：大提琴组守着 C–G 的空五度，
// 高处第二小提琴与中提琴极轻的空五度，B 段低音提琴的长音；星是钟琴，竖琴低八度轻轻跟着。用大厅混响。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_PACIFIC as SYNTH } from "../../tracks/seaPacific";
import { chords, line, pick, retarget, SEAT } from "./kit";

export const SEA_PACIFIC: TrackDef = {
  id: "sea_pacific",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.35,
  hall: true,
  space: 1.2,
  voices: {
    ...pick(SYNTH.voices, ["flute", "pu", "ukeke", "bow", "pahu", "kalaau", "garamut"]),
    glock: line("o.glock", 0.085, SEAT.glock, 0.7),
    hp: line("o.harp", 0.14, SEAT.harp, 0.6),
    vhi: chords("o.vn", 0.05, SEAT.vn2, 0.55, 67, 81, 2),
    va: chords("o.va", 0.046, SEAT.va, 0.5, 55, 69, 2),
    pedal: { inst: "o.vc", gain: 0.1, pan: SEAT.vc, reverb: 0.4, poly: true, pattern: { kind: "drone", notes: [36, 43] } },
    cb: chords("o.cb", 0.095, SEAT.cb, 0.32, 28, 40, 1),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { celesta: "glock hp-12", pad: "vhi va", low: "cb" }),
  rest: SYNTH.rest,
};
