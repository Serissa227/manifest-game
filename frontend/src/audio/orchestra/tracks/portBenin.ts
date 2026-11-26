// 《胡椒与铜手镯》管弦版：贝宁湾的乐器领奏（两张阿克帕塔弓琴、三支象牙号、伊亚伊卢母鼓与甘甘、埃戈戈铁双铃、古杜古杜小锅鼓、珠网沙铃——与合成版共用这些声部），
// 管弦只做衬底：大提琴组在低处拉根音的长音、低音提琴拨奏落在每小节的头上，中提琴与高处的小提琴极轻地拉空五度（D–A、C–G），
// 跟着 D 与 C 两个“地方”走。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_BENIN as SYNTH } from "../../tracks/portBenin";
import { chords, line, pick, retarget, SEAT, WET } from "./kit";

export const PORT_BENIN: TrackDef = {
  id: "port_benin",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["akpata", "akpata2", "horn1", "horn2", "horn3", "iya", "gangan", "bell", "gudu", "ukuse"]),
    vc: line("o.vc", 0.11, SEAT.vc, WET.low),
    cbp: line("o.cb.pizz", 0.1, SEAT.cb, WET.low),
    va: chords("o.va", 0.065, SEAT.va, 0.4, 48, 64, 2),
    vn: chords("o.vn", 0.037, SEAT.vn2, 0.46, 67, 81, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { low: "vc cbp", pad: "va vn" }),
  rest: SYNTH.rest,
  level: 1.34,
};
