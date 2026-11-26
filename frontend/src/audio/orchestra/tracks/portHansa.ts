// 《鲱鱼与盐的码头》管弦版：地方乐器领奏（两把尼克尔哈帕、朗格莱克琴、山羊角号、跺脚，城市乐手的三支克鲁姆管与长鼓——与合成版共用这些声部），
// 管弦只做衬底：大提琴组在低处拉根音的长音、低音提琴拨奏落在每小节第一拍，中提琴极轻的空五度。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_HANSA as SYNTH } from "../../tracks/portHansa";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_HANSA: TrackDef = {
  id: "port_hansa",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  groove: SYNTH.groove,
  voices: {
    ...pick(SYNTH.voices, ["nyck1", "nyck2", "lang", "horn", "stomp", "crum1", "crum2", "crum3", "trom"]),
    vc: line("o.vc", 0.15, SEAT.vc, WET.low, bass("1 . . . . .", 38, 6)),
    cbp: pulse("o.cb.pizz", 0.16, SEAT.cb, WET.low, bass("1 . . . . .", 33, 2)),
    va: chords("o.va", 0.09, SEAT.va, 0.4, 50, 64, 2),
    vn: chords("o.vn", 0.05, SEAT.vn2, 0.46, 69, 81, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vn", low: "vc cbp" }),
  rest: SYNTH.rest,
  level: 0.89,
};
