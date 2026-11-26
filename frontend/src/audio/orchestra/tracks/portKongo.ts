// 《贝币与棕榈布》管弦版：刚果的乐器领奏（利肯贝、马丁巴、恩桑比弓琴、姆蓬吉象牙号、恩贡吉双铃、沙铃、恩戈马鼓、裂缝木鼓——与合成版共用这些声部），
// 管弦只做衬底：大提琴组在低处拉 G 的长音、低音提琴拨奏落在每小节的头上、大提琴组的拨奏轻轻落在附点四分音符上，中提琴与高处的小提琴极轻地拉 G–D 的空五度。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_KONGO as SYNTH } from "../../tracks/portKongo";
import { bass, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_KONGO: TrackDef = {
  id: "port_kongo",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["likembe", "madimba", "madimba2", "nsambi", "horn1", "horn2", "bell", "rattle", "ngoma", "slit"]),
    vc: line("o.vc", 0.14, SEAT.vc, WET.low),
    cbp: line("o.cb.pizz", 0.14, SEAT.cb, WET.low),
    va: { inst: "o.va", gain: 0.08, pan: SEAT.va, reverb: 0.4, poly: true, pattern: { kind: "drone", notes: [55, 62] } },
    // 大提琴组的拨奏轻轻落在附点四分音符上（G 与 D），跟着恩戈马鼓的低音
    vcp: pulse("o.vc.pizz", 0.1, SEAT.vc, WET.low, bass("1 . . 5 . . 1 . . 5 . .", 43, 2)),
    vn: { inst: "o.vn", gain: 0.045, pan: SEAT.vn2, reverb: 0.46, poly: true, pattern: { kind: "drone", notes: [67, 74] } },
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { low: "vc cbp", pad: "va vn vcp" }),
  rest: SYNTH.rest,
  level: 1.12,
};
