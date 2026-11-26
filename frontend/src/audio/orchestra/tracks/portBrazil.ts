// 《巴西木的海岸》管弦版：图皮的乐器领奏（两支塔博卡竹笛、海螺号、姆巴拉卡圣沙铃、塔夸普跺地竹筒——与合成版共用这些声部），
// 管弦只做衬底：大提琴组在低处拉 E 的长音（换到 A、D 时跟着换）、中提琴很轻的空五度，低音提琴拨奏轻轻落在跺地竹筒的低音上。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_BRAZIL as SYNTH } from "../../tracks/portBrazil";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_BRAZIL: TrackDef = {
  id: "port_brazil",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["flute", "flute2", "conch", "rattle", "stamp"]),
    vc: line("o.vc", 0.13, SEAT.vc, WET.low, bass("1 . . . . . . .", 40, 8)),
    va: chords("o.va", 0.07, SEAT.va, 0.42, 52, 66, 2),
    cbp: pulse("o.cb.pizz", 0.12, SEAT.cb, WET.low, bass("1 . . . 1 . . .", 33, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vc cbp" }),
  rest: SYNTH.rest,
  level: 1.35,
};
