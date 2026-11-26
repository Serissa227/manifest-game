// 《花与歌》管弦版：阿兹特克的乐器领奏（两支特拉皮查利陶笛、风哨、海螺号、特波纳兹特利木鼓、韦韦特尔立鼓、果壳串、响杖、骨刮、龟甲——与合成版共用这些声部），
// 管弦只做衬底：大提琴组在低处拉每小节的根音长音、中提琴很轻的空五度，低音提琴拨奏落在“to-co”与第二个“to-co”上（木鼓的低舌下面多一点音高）。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_AZTEC as SYNTH } from "../../tracks/portAztec";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_AZTEC: TrackDef = {
  id: "port_aztec",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["flute", "flute2", "wind", "conch", "tepo", "huehue", "ayo", "staff", "shell", "bone"]),
    vc: line("o.vc", 0.14, SEAT.vc, WET.low, bass("1 . . . . . . . . .", 38, 10)),
    va: chords("o.va", 0.08, SEAT.va, 0.42, 50, 64, 2),
    cbp: pulse("o.cb.pizz", 0.13, SEAT.cb, WET.low, bass("1 . . . . 1 . . . .", 33, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vc cbp" }),
  rest: SYNTH.rest,
  level: 1.2,
};
