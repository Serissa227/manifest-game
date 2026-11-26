// 《貂皮与东珠》管弦版：地方乐器领奏（口弦、号角、神鼓、腰铃——与合成版共用这些声部），
// 管弦只做衬底：大提琴组在低处拉 G 的长音，低音提琴拨奏跟着马跑的两拍，中提琴与很远的圆号极轻地吹 G–D 空五度（像林子那头的号）。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_JURCHEN as SYNTH } from "../../tracks/portJurchen";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_JURCHEN: TrackDef = {
  id: "port_jurchen",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["mukun", "buren", "yemcen", "sisa"]),
    vc: line("o.vc", 0.14, SEAT.vc, WET.low, bass("1 . . . . .", 36, 6)),
    cbp: pulse("o.cb.pizz", 0.14, SEAT.cb, WET.low, bass("1 . . 1 . .", 31, 2)),
    va: chords("o.va", 0.075, SEAT.va, 0.4, 50, 64, 2),
    hn: chords("o.hn", 0.045, SEAT.hn, WET.brass, 50, 62, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va hn", low: "vc cbp" }),
  rest: SYNTH.rest,
  level: 1.15,
};
