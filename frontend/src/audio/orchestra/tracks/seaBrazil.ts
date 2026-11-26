// 《巴西海流》管弦版（D 多利亚慢 4/4，图皮人划独木舟的歌）：图皮的乐器领奏（两支塔博卡竹笛、海螺号、姆巴拉卡圣沙铃、塔夸普竹筒——
// 与合成版共用这些声部），管弦只做衬底：大提琴组在低处拉根音的长音（D，换到 A、C 时跟着换）、中提琴很轻的空五度，
// 低音提琴拨奏轻轻落在两下划桨上。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_BRAZIL as SYNTH } from "../../tracks/seaBrazil";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_BRAZIL: TrackDef = {
  id: "sea_brazil",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["flute", "flute2", "conch", "rattle", "stamp"]),
    vc: line("o.vc", 0.11, SEAT.vc, WET.low, bass("1 . . . . . . .", 38, 8)),
    va: chords("o.va", 0.06, SEAT.va, 0.44, 50, 66, 2),
    cbp: pulse("o.cb.pizz", 0.1, SEAT.cb, WET.low, bass("1 . . . 1 . . .", 33, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vc cbp" }),
  rest: SYNTH.rest,
  level: 1.4,
};
