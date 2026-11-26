// 《阿里卡的银》管弦版：安第斯的乐器领奏（盖那笛、两排排箫、塔尔卡木笛、恰朗戈、邦博鼓、羊蹄壳串——与合成版共用这些声部），
// 管弦只做衬底：第二小提琴与中提琴很轻的和弦长音，大提琴组与低音提琴拨奏走低音。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_ANDES as SYNTH } from "../../tracks/portAndes";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_ANDES: TrackDef = {
  id: "port_andes",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["quena", "ira", "arka", "tarka", "charango", "bombo", "chajchas"]),
    vn2: chords("o.vn", 0.06, SEAT.vn2, 0.4, 64, 76, 2),
    va: chords("o.va", 0.08, SEAT.va, 0.4, 55, 67, 2),
    vcp: pulse("o.vc.pizz", 0.26, SEAT.vc, WET.low, bass("1 . 5, . 1 . 5, .", 45, 2)),
    cbp: pulse("o.cb.pizz", 0.16, SEAT.cb, WET.low, bass("1 . . . . . . .", 33, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { strings: "vn2 va", bass: "vcp cbp" }),
  rest: SYNTH.rest,
  level: 1.18,
};
