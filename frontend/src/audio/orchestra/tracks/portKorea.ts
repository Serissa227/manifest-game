// 《浦口的长鼓》管弦版：地方乐器领奏（伽倻琴、玄琴、奚琴、大笒、觱篥、太平箫、钲、杖鼓、鼓、小金——与合成版共用这些声部），
// 管弦只做衬底：大提琴组在低处拉长短第一拍的根音，低音提琴拨奏落在长短的第一拍与第七拍，
// 中提琴很轻的空五度（A–E、G–D……），高处小提琴极轻的空五度像江面上的雾。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_KOREA as SYNTH } from "../../tracks/portKorea";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_KOREA: TrackDef = {
  id: "port_korea",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["gayageum", "geomungo", "haegeum", "daegeum", "piri", "taep", "jing", "janggu", "buk", "kkwaeng"]),
    vc: line("o.vc", 0.12, SEAT.vc, WET.low, bass("1 . . . . . . . . . . .", 40, 12)),
    cbp: pulse("o.cb.pizz", 0.12, SEAT.cb, WET.low, bass("1 . . . . . 5 . . . . .", 33, 2)),
    va: chords("o.va", 0.064, SEAT.va, 0.4, 52, 67, 2),
    vn: chords("o.vn", 0.036, SEAT.vn2, 0.46, 71, 86, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vn", low: "vc cbp" }),
  rest: SYNTH.rest,
  level: 1.33,
};
