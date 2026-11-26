// 《勃固的鼓圈》管弦版：缅甸的 hsaing waing 乐队领奏（鼓圈、锣圈、赫奈、弯琴、锡与瓦、帕玛吊鼓——与合成版共用这些声部），
// 管弦只做衬底：大提琴组与中提琴极轻的 C–G 空五度、高处小提琴更轻的 G–C，低音提琴拨奏在句尾与突然停顿之后点一下。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。A′ 里突然停住的那一小节（A2s）合成版不放持续音，
// 这里也就没有大提琴组、中提琴、小提琴的持续音——停顿里静下来的是整个乐队，弦乐不在下面垫着。
import type { TrackDef } from "../../score";
import { PORT_BURMA as SYNTH } from "../../tracks/portBurma";
import { held, line, pick, retarget, SEAT, WET } from "./kit";

export const PORT_BURMA: TrackDef = {
  id: "port_burma",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["pat", "kyi", "hne", "saung", "siwa", "patma"]),
    vc: { ...held("o.vc", 0.09, SEAT.vc, WET.low), pattern: { kind: "drone", notes: [36, 43] } },
    va: { ...held("o.va", 0.05, SEAT.va, 0.44), pattern: { kind: "drone", notes: [55, 60] } },
    vn: { ...held("o.vn", 0.035, SEAT.vn2, 0.5), pattern: { kind: "drone", notes: [79, 84] } },
    cbp: line("o.cb.pizz", 0.22, SEAT.cb, WET.low),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "vc va vn", bass: "cbp" }),
  rest: SYNTH.rest,
  level: 1.38,
};
