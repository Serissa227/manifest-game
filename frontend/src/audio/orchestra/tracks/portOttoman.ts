// 《金角湾的集市》管弦版：地方乐器领奏（乌德琴、卡农琴、奈伊笛、克曼切、祖尔纳、库都姆、本迪尔、铃鼓、达乌尔——与合成版共用这些声部），
// 管弦只做衬底：大提琴组在低处拉“dem”的根音长音、低音提琴拨奏落在杜耶克的“咚”上、中提琴很轻的空五度。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_OTTOMAN as SYNTH } from "../../tracks/portOttoman";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_OTTOMAN: TrackDef = {
  id: "port_ottoman",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["ud", "kanun", "nay", "kemence", "zurna", "kudum", "bendir", "riq", "davul"]),
    vc: line("o.vc", 0.15, SEAT.vc, WET.low, bass("1 . . . . . . .", 45, 8)),
    cbp: pulse("o.cb.pizz", 0.2, SEAT.cb, WET.low, bass("1 . . . 1 . . .", 33, 2)),
    va: chords("o.va", 0.09, SEAT.va, 0.4, 52, 69, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { dem: "va vc", bass: "cbp" }),
  rest: SYNTH.rest,
  level: 1.1,
};
