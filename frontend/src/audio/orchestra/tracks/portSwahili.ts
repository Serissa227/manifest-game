// 《珊瑚石的城》管弦版：斯瓦希里海岸的乐器领奏（乌德琴、祖马里、卡农琴、拇指琴、恩戈马鼓、卡亚姆巴、塔里框鼓——与合成版共用这些声部），
// 管弦只做衬底与应答：塔拉布里的提琴由小提琴组（真的弦乐）拉，“众和”由中提琴与低八度的大提琴组齐声应（代替合成版的人声），
// 第二小提琴与中提琴很轻的和弦长音，大提琴组与低音提琴拨奏走低音。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_SWAHILI as SYNTH } from "../../tracks/portSwahili";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_SWAHILI: TrackDef = {
  id: "port_swahili",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["ud", "zumari", "kanun", "kalimba", "ngoma", "kayamba", "tari"]),
    vn: line("o.vn", 0.36, SEAT.vn1, WET.strings),
    vaR: line("o.va", 0.28, SEAT.va, WET.strings),
    vcR: line("o.vc", 0.22, SEAT.vc, WET.strings),
    vn2: chords("o.vn", 0.06, SEAT.vn2, 0.4, 64, 77, 2),
    vaP: chords("o.va", 0.08, SEAT.va, 0.4, 55, 69, 2),
    vcp: pulse("o.vc.pizz", 0.26, SEAT.vc, WET.low, bass("1 . . 5, . . 1 .", 41, 2)),
    cbp: pulse("o.cb.pizz", 0.16, SEAT.cb, WET.low, bass("1 . . . . . . .", 29, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { fiddle: "vn", choir: "vaR vcR-12", strings: "vn2 vaP", bass: "vcp cbp" }),
  rest: SYNTH.rest,
  level: 1.17,
};
