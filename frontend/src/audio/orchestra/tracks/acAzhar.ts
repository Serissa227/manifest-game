// 《爱资哈尔的长廊》管弦版（学院的短主题·开罗的爱资哈尔，C 拉斯特，慢 4/4）。
// 地方特色第二阶段重编：地方乐器领奏（卡农琴、乌德琴、奈伊笛、卡曼恰、达布卡、里克鼓——与合成版共用这些声部），
// 管弦只做衬底：大提琴组拉 C–G 的持续音（原来那一层），中提琴很轻的空五度，低音提琴在“咚”上很轻地拨。四分之一音照样奏。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { AC_AZHAR as SYNTH } from "../../tracks/acAzhar";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const AC_AZHAR: TrackDef = {
  id: "ac_azhar",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.12,
  voices: {
    ...pick(SYNTH.voices, ["kanun", "ud", "nay", "kamancheh", "darb", "riq"]),
    vcd: { inst: "o.vc", gain: 0.13, pan: SEAT.vc, reverb: 0.34, poly: true, pattern: { kind: "drone", notes: [36, 43] } },
    va: chords("o.va", 0.07, SEAT.va, 0.4, 52, 69, 2),
    cbp: pulse("o.cb.pizz", 0.16, SEAT.cb, WET.low, bass("1 . 1 . . . . .", 33, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { drone: "vcd va", bass: "cbp" }),
  rest: SYNTH.rest,
};
