// 《赤道的长浪》管弦版：非洲西岸的乐器领奏（科拉琴、坦宾笛、巴拉丰、利肯贝、马丁巴、姆蓬吉象牙号、说话鼓、金贝鼓、敦敦鼓、谢凯雷、双铃、沙铃、恩戈马鼓、裂缝木鼓——
// 与合成版共用这些声部），管弦只做衬底：大提琴组在低处拉根音的长音、低音提琴拨奏落在每小节的头上，中提琴与高处的小提琴很轻地拉空五度，
// 像远处一层一层的浪。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_GUINEA as SYNTH } from "../../tracks/seaGuinea";
import { chords, line, pick, retarget, SEAT, WET } from "./kit";

export const SEA_GUINEA: TrackDef = {
  id: "sea_guinea",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["kora", "tambin", "balafon", "likembe", "madimba", "horn1", "horn2", "gangan", "djembe", "dundun", "shekere", "bell", "rattle", "ngoma", "slit"]),
    vc: line("o.vc", 0.11, SEAT.vc, WET.low),
    cbp: line("o.cb.pizz", 0.1, SEAT.cb, WET.low),
    va: chords("o.va", 0.067, SEAT.va, 0.44, 50, 64, 2),
    vn: chords("o.vn", 0.037, SEAT.vn2, 0.5, 69, 81, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { low: "vc cbp", pad: "va vn" }),
  rest: SYNTH.rest,
  level: 1.16,
};
