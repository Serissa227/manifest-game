// 《白海岸的钟声》管弦版：地方乐器领奏（教堂的大钟、中钟与小钟、扎列伊卡、古多克与它的空弦、古斯里琴、木勺、布本鼓、木片响板——与合成版共用这些声部），
// 管弦只做衬底：大提琴组在低处拉根音的长音、低音提琴拨奏落在每小节第一拍，中提琴极轻的空五度 / 调式和弦。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_RUSSIA as SYNTH } from "../../tracks/portRussia";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_RUSSIA: TrackDef = {
  id: "port_russia",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["bigbell", "mbells", "bells", "zhal", "gudok", "gdrone", "gusli", "lozhki", "buben", "tresh"]),
    vc: line("o.vc", 0.15, SEAT.vc, WET.low, bass("1 . . .", 45, 4)),
    cbp: pulse("o.cb.pizz", 0.16, SEAT.cb, WET.low, bass("1 . . .", 33, 2)),
    va: chords("o.va", 0.09, SEAT.va, 0.4, 52, 67, 2),
    vn: chords("o.vn", 0.05, SEAT.vn2, 0.46, 69, 81, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vn", low: "vc cbp" }),
  rest: SYNTH.rest,
  level: 0.94,
};
