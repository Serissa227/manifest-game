// 《商馆与凉廊》管弦版：意大利的乐器领奏（短号、萨克布、四种竖笛、便携管风琴、簧管风琴、鲁特琴、维奥尔琴、意大利铃鼓、小定音鼓——与合成版共用这些声部），
// 管弦只做衬底：中提琴很轻的和弦长音、大提琴组的根音长音、低音提琴拨奏。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_ITALY as SYNTH } from "../../tracks/portItaly";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_ITALY: TrackDef = {
  id: "port_italy",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["cornett", "sba", "sbt", "sbb", "recs", "reca", "rect", "recb", "organ", "regal", "liuto", "gamba", "tamb", "nakers"]),
    va: chords("o.va", 0.09, SEAT.va, 0.4, 55, 67, 2),
    vc: line("o.vc", 0.135, SEAT.vc, WET.low, bass("1 . . . . . . .", 43, 8)),
    cbp: pulse("o.cb.pizz", 0.2, SEAT.cb, WET.low, bass("1 . . . 5, . . .", 31, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vc", pz: "cbp" }),
  rest: SYNTH.rest,
  level: 1.02,
};
