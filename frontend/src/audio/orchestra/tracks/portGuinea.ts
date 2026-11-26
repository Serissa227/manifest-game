// 《鼓语与金沙》管弦版：曼丁的乐器领奏（两把科拉琴、巴拉丰、恩戈尼、说话鼓、金贝鼓、敦敦鼓与铁铃、谢凯雷——与合成版共用这些声部），
// 管弦只做衬底：大提琴组在低处拉根音的长音、低音提琴拨奏落在每小节的头上，中提琴与高处的小提琴极轻地拉空五度（C–G、F–C、G–D），
// 跟着科拉琴昆本戈的“地方”走。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_GUINEA as SYNTH } from "../../tracks/portGuinea";
import { chords, line, pick, retarget, SEAT, WET } from "./kit";

export const PORT_GUINEA: TrackDef = {
  id: "port_guinea",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["kora", "kora2", "balafon", "ngoni", "gangan", "djembe", "dundun", "ken", "bell", "shekere"]),
    vc: line("o.vc", 0.14, SEAT.vc, WET.low),
    cbp: line("o.cb.pizz", 0.14, SEAT.cb, WET.low),
    va: chords("o.va", 0.08, SEAT.va, 0.4, 48, 64, 2),
    vn: chords("o.vn", 0.045, SEAT.vn2, 0.46, 67, 81, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { low: "vc cbp", pad: "va vn" }),
  rest: SYNTH.rest,
  level: 1.08,
};
