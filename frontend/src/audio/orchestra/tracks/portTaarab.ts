// 《满月的塔拉布》管弦版（斯瓦希里海岸的港口的第二首，E 巴亚提，4/4）：海岸的乐器领奏
// （乌德琴、卡农琴、祖马里、拇指琴的固定音型、恩戈马鼓、卡亚姆巴沙箱、塔里框鼓——与合成版共用这些声部），
// 管弦只做衬底：大提琴与中提琴极轻的空五度长音，大提琴组与低音提琴的拨奏。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_TAARAB as SYNTH } from "../../tracks/portTaarab";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_TAARAB: TrackDef = {
  id: "port_taarab",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.33,
  voices: {
    ...pick(SYNTH.voices, ["ud", "kanun", "zum", "kal", "ngoma", "kay", "tari"]),
    vc: chords("o.vc", 0.07, SEAT.vc, 0.4, 40, 55, 1),
    va: chords("o.va", 0.07, SEAT.va, 0.42, 52, 64, 2),
    vcp: pulse("o.vc.pizz", 0.18, SEAT.vc, WET.low, bass("1 . . . 5 . . .", 40, 2)),
    cbp: pulse("o.cb.pizz", 0.14, SEAT.cb, WET.low, bass("1 . . . . . . .", 28, 3)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { drone: "vc va", pz: "vcp cbp" }),
  rest: SYNTH.rest,
};
