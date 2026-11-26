// 《贝伦的晚钟》管弦版（伊比利亚人的港口的第二首，E 小调 3/4，慢）：伊比利亚的乐器领奏
// （维奥尔琴、中音竖笛、便携管风琴、短号、维韦拉琴的分解和弦、阿杜菲方鼓——与合成版共用这些声部），
// 管弦只做衬底：远处的钟用管钟，第二小提琴与中提琴很轻的和弦长音，大提琴组与低音提琴的拨奏。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_IBERIA_EVE as SYNTH } from "../../tracks/portIberiaEve";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_IBERIA_EVE: TrackDef = {
  id: "port_iberia_eve",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.23,
  space: SYNTH.space,
  voices: {
    ...pick(SYNTH.voices, ["gamba", "reca", "org", "cornett", "varp", "adufe"]),
    bells: line("o.tubular", 0.12, SEAT.bells, WET.bells),
    vn2: chords("o.vn", 0.06, SEAT.vn2, 0.42, 64, 76, 2),
    va: chords("o.va", 0.08, SEAT.va, 0.42, 55, 67, 2),
    vcp: pulse("o.vc.pizz", 0.2, SEAT.vc, WET.low, bass("1 . . . 5 .", 40, 2)),
    cbp: pulse("o.cb.pizz", 0.15, SEAT.cb, WET.low, bass("1 . . . . .", 28, 3)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { bell: "bells", pad: "vn2 va", pz: "vcp cbp" }),
  rest: SYNTH.rest,
};
