// 《修院的晨课》管弦版（学院的短主题·梅里达的修院，D 多利亚慢 4/4）：旋律与和声同合成版。
// 修士的一边是管弦：圣咏是中提琴与大提琴组齐奏（像修士们的齐唱），管钟是修院的钟，低音提琴与圆号很轻的空五度长音像奥尔加农；
// 玛雅的一边与合成版共用同一份声部：两支陶笛、奇里米亚木管（再唱一遍时吹修士的那一句）、屯库尔木鼓、龟甲、葫芦沙铃。
// 曲式、段落与合成版一模一样（retarget 只换修士那一边的声部）。
import type { TrackDef } from "../../score";
import { AC_MERIDA as SYNTH } from "../../tracks/acMerida";
import { chords, line, pick, retarget, SEAT, WET } from "./kit";

export const AC_MERIDA: TrackDef = {
  id: "ac_merida",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  space: 1.2,
  level: 1.12,
  voices: {
    ...pick(SYNTH.voices, ["flute", "flute2", "chirimia", "slit", "shell", "rattle"]),
    va: line("o.va", 0.38, SEAT.va, 0.55),
    vc: line("o.vc", 0.34, SEAT.vc, 0.55),
    tubular: line("o.tubular", 0.26, SEAT.bells, WET.bells),
    cb: chords("o.cb", 0.14, SEAT.cb, 0.4, 26, 38, 1),
    hn: chords("o.hn", 0.08, SEAT.hn, 0.5, 45, 57, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { chant: "va vc", bell: "tubular", organum: "cb hn" }),
  rest: SYNTH.rest,
};
