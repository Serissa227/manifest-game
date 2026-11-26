// 《咖啡馆的午后》管弦版（奥斯曼的港口与城市的第二首，D 拉斯特，9/8 的阿克萨克）：奥斯曼的乐器领奏
// （坦布尔琴、卡农琴、奈伊笛、克曼切、乌德琴的低音、达布卡、本迪尔框鼓、里克鼓——与合成版共用这些声部），
// 管弦只做衬底：大提琴与中提琴极轻的空五度长音，大提琴组与低音提琴的拨奏。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_OTTOMAN_CAFE as SYNTH } from "../../tracks/portOttomanCafe";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_OTTOMAN_CAFE: TrackDef = {
  id: "port_ottoman_cafe",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 0.99,
  voices: {
    ...pick(SYNTH.voices, ["tanb", "kanun", "nay", "kem", "ud", "darb", "bend", "riq"]),
    vc: chords("o.vc", 0.07, SEAT.vc, 0.4, 38, 52, 1),
    va: chords("o.va", 0.07, SEAT.va, 0.42, 50, 64, 2),
    vcp: pulse("o.vc.pizz", 0.18, SEAT.vc, WET.low, bass("1 . . . . . 5 . .", 38, 2)),
    cbp: pulse("o.cb.pizz", 0.14, SEAT.cb, WET.low, bass("1 . . . . . . . .", 26, 3)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { drone: "vc va", pz: "vcp cbp" }),
  rest: SYNTH.rest,
};
