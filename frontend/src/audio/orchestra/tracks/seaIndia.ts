// 《雨季的船歌》管弦版：地方乐器领奏（班苏里、萨朗吉、萨拉斯瓦蒂维纳琴、多塔拉、水碗、坦布拉，塔布拉、琴达、小钹——与合成版共用这些声部），
// 管弦只做衬底：大提琴组在低处拉萨（E）的长音，拨奏隔一小节轻轻点一下萨与帕，中提琴与高处的小提琴很轻地拉 E–B 空五度。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_INDIA as SYNTH } from "../../tracks/seaIndia";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_INDIA: TrackDef = {
  id: "sea_india",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["bansuri", "sarangi", "veena", "dotara", "jalt", "tanpura", "tabla", "bayan", "che", "chv", "talam"]),
    vc: line("o.vc", 0.15, SEAT.vc, WET.low, bass("1 . . . . . . . . . . .", 40, 12)),
    vcp: pulse("o.vc.pizz", 0.14, SEAT.vc, WET.low, bass("1 . . . . . 5 . . . . .", 40, 2)),
    va: chords("o.va", 0.08, SEAT.va, 0.42, 59, 71, 2),
    vn: chords("o.vn", 0.05, SEAT.vn2, 0.46, 76, 88, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vn", low: "vc vcp" }),
  rest: SYNTH.rest,
  level: 1.06,
};
