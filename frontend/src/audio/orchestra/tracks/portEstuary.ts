// 《河口的晚风》管弦版（法兰西人的港口的第二首，D 多利亚 3/4）：法兰西的乐器领奏
// （手摇弦琴与它的持续音弦、加卢贝笛、法兰西风笛、鲁特琴的分解和弦、普罗旺斯长鼓——与合成版共用这些声部），
// 管弦只做衬底：第二小提琴与中提琴很轻的和弦长音，大提琴组与低音提琴的拨奏。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_ESTUARY as SYNTH } from "../../tracks/portEstuary";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_ESTUARY: TrackDef = {
  id: "port_estuary",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.36,
  voices: {
    ...pick(SYNTH.voices, ["hg", "hd", "gal", "corn", "luth", "tamb"]),
    vn2: chords("o.vn", 0.06, SEAT.vn2, 0.4, 62, 76, 2),
    va: chords("o.va", 0.08, SEAT.va, 0.4, 53, 67, 2),
    vcp: pulse("o.vc.pizz", 0.2, SEAT.vc, WET.low, bass("1 . . . 5 .", 38, 2)),
    cbp: pulse("o.cb.pizz", 0.15, SEAT.cb, WET.low, bass("1 . . . . .", 26, 3)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "vn2 va", pz: "vcp cbp" }),
  rest: SYNTH.rest,
};
