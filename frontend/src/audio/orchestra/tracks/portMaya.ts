// 《可可与玉米的市》管弦版：玛雅的乐器领奏（两支陶笛、海螺号、屯库尔木鼓、龟甲、葫芦沙铃、帕克斯鼓——与合成版共用这些声部），
// 管弦只做衬底：大提琴组在低处拉每小节的根音长音、中提琴很轻的空五度，大提琴组拨奏轻轻跟着屯库尔木鼓的两个音（木头的空响下面多一点音高）。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_MAYA as SYNTH } from "../../tracks/portMaya";
import { bass, chords, line, pick, retarget, SEAT, WET } from "./kit";

export const PORT_MAYA: TrackDef = {
  id: "port_maya",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["ocarina", "ocarina2", "conch", "slit", "shell", "rattle", "drum"]),
    vc: line("o.vc", 0.14, SEAT.vc, WET.low, bass("1 . . . . .", 41, 6)),
    va: chords("o.va", 0.08, SEAT.va, 0.42, 55, 69, 2),
    vcp: line("o.vc.pizz", 0.12, SEAT.vc, WET.low),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vc", slit: "slit vcp" }),
  rest: SYNTH.rest,
  level: 1.22,
};
