// 《霍尔木兹的丝毯》管弦版：地方乐器领奏（桑图尔、塔尔琴、赛塔尔琴、卡曼恰、奈伊笛、东巴克鼓、达夫框鼓——与合成版共用这些声部），
// 管弦只做衬底：大提琴组在低处拉 C 的长音，低音提琴每小节很轻地拨一下，中提琴很轻的空五度（C–G）。
// 曲式、段落、速度的变化（阿瓦兹放慢、四击加快）与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_PERSIA as SYNTH } from "../../tracks/portPersia";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_PERSIA: TrackDef = {
  id: "port_persia",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["santur", "tar", "setar", "kamancheh", "nay", "tombak", "daf"]),
    vc: line("o.vc", 0.14, SEAT.vc, WET.low, bass("1 . . . . .", 36, 6)),
    cbp: pulse("o.cb.pizz", 0.16, SEAT.cb, WET.low, bass("1 . . . . .", 33, 3)),
    va: chords("o.va", 0.08, SEAT.va, 0.42, 52, 69, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { dem: "va vc", bass: "cbp" }),
  rest: SYNTH.rest,
  level: 1.0,
};
