// 《潟湖的鼓声》管弦版：太平洋的乐器领奏（鼻笛、普、乌克克口弓、查莫罗的葫芦弓、顿竹筒、伊普、乌利乌利、伊利伊利、帕胡鼓、普纽、帕特、法阿特特——
// 与合成版共用这些声部），管弦只做衬底：大提琴组在低处拉每小节的根音长音、中提琴很轻的空五度、高处小提琴极轻的空五度像潟湖上的雾气，
// 大提琴拨奏轻轻跟着顿竹筒的两个音（竹筒的空响下面多一点音高）。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_POLYNESIA as SYNTH } from "../../tracks/portPolynesia";
import { bass, chords, line, pick, retarget, SEAT, WET } from "./kit";

export const PORT_POLYNESIA: TrackDef = {
  id: "port_polynesia",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["flute", "pu", "ukeke", "bow", "tubes", "ipu", "uliuli", "ilili", "pahu", "puniu", "pate1", "pate2", "faatete"]),
    vc: line("o.vc", 0.115, SEAT.vc, WET.low, bass("1 . . . . . . .", 38, 8)),
    va: chords("o.va", 0.053, SEAT.va, 0.42, 55, 69, 2),
    vn: chords("o.vn", 0.04, SEAT.vn2, 0.48, 74, 88, 2),
    vcp: line("o.vc.pizz", 0.11, SEAT.vc, WET.low),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vn", low: "vc", tubes: "tubes vcp" }),
  rest: SYNTH.rest,
  level: 1.2,
};
