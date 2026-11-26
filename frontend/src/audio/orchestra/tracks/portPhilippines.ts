// 《霍洛的锣》管弦版：库林唐锣乐领奏（库林唐、阿贡、甘丁甘、库迪亚皮、苏灵笛、巴本迪尔、达巴坎——与合成版共用这些声部），
// 管弦只做衬底：大提琴组与中提琴极轻的 G–D 空五度、高处小提琴更轻的 D–G，低音提琴拨奏轻轻跟着阿贡（给锣的低音一点“落地”）。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_PHILIPPINES as SYNTH } from "../../tracks/portPhilippines";
import { held, line, pick, retarget, SEAT, WET } from "./kit";

export const PORT_PHILIPPINES: TrackDef = {
  id: "port_philippines",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["kul", "agung", "gand", "kud", "suling", "babendil", "dabakan"]),
    vc: { ...held("o.vc", 0.085, SEAT.vc, WET.low), pattern: { kind: "drone", notes: [43, 50] } },
    va: { ...held("o.va", 0.05, SEAT.va, 0.44), pattern: { kind: "drone", notes: [55, 62] } },
    vn: { ...held("o.vn", 0.035, SEAT.vn2, 0.5), pattern: { kind: "drone", notes: [74, 79] } },
    cbp: line("o.cb.pizz", 0.12, SEAT.cb, WET.low),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "vc va vn", agung: "agung cbp" }),
  rest: SYNTH.rest,
  level: 1.28,
};
