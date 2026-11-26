// 《棉布与靛蓝的码头》管弦版：地方乐器领奏（西塔琴、班苏里、谢赫奈、桑图尔、坦布拉、塔布拉——与合成版共用这些声部），
// 管弦只做衬底：大提琴组在低处拉萨（D）的长音，拨奏在每轮的第一拍（萨姆）与第五拍轻轻点一下萨与帕，
// 安塔拉里中提琴与高处的小提琴很轻地拉 D–A 空五度，像坦布拉的光。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_INDIA as SYNTH } from "../../tracks/portIndia";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_INDIA: TrackDef = {
  id: "port_india",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["sitar", "bansuri", "shehnai", "santoor", "tanpura", "tabla", "bayan"]),
    vc: line("o.vc", 0.15, SEAT.vc, WET.low, bass("1 . . . . . . .", 38, 8)),
    vcp: pulse("o.vc.pizz", 0.14, SEAT.vc, WET.low, bass("1 . . . 5 . . .", 38, 2)),
    va: chords("o.va", 0.08, SEAT.va, 0.42, 57, 69, 2),
    vn: chords("o.vn", 0.05, SEAT.vn2, 0.46, 74, 86, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vn", low: "vc vcp" }),
  rest: SYNTH.rest,
  level: 1.16,
};
