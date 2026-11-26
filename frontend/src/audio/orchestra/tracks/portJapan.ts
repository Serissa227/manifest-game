// 《町家与潮风》管弦版：地方乐器领奏（三味线、尺八、筝、篠笛、太鼓、缔太鼓、小鼓、拍子木、当钲——与合成版共用这些声部），
// 管弦只做衬底：大提琴组在低处拉长音的根音、低音提琴拨奏落在每小节第一拍，中提琴很轻的空五度（E–B、A–E……），
// 高处小提琴极轻的空五度像远处的雾。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_JAPAN as SYNTH } from "../../tracks/portJapan";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_JAPAN: TrackDef = {
  id: "port_japan",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["shami", "shaku", "koto", "fue", "kane", "taiko", "shime", "tsuzumi", "hyo"]),
    vc: line("o.vc", 0.16, SEAT.vc, WET.low, bass("1 . . . . . . .", 40, 8)),
    cbp: pulse("o.cb.pizz", 0.16, SEAT.cb, WET.low, bass("1 . . . . . . .", 28, 2)),
    va: chords("o.va", 0.09, SEAT.va, 0.4, 52, 67, 2),
    vn: chords("o.vn", 0.05, SEAT.vn2, 0.46, 71, 86, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vn", low: "vc cbp" }),
  rest: SYNTH.rest,
  level: 1.15,
};
