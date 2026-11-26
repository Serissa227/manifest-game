// 《航路的长诗》管弦版（学院的短主题·船上学堂，D 巴亚提 4/4 的马克苏姆）。
// 地方特色第二阶段重编：地方乐器领奏（乌德琴、奈伊笛、卡农琴、西姆西米亚琴、达布卡、里克鼓、拍手——与合成版共用这些声部），
// 管弦只做衬底：大提琴组拉 D–A 的持续音（原来那一层），中提琴很轻的空五度跟着根音走，低音提琴在马克苏姆的两个“咚”上很轻地拨。四分之一音照样奏。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { AC_SHIP as SYNTH } from "../../tracks/acShip";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const AC_SHIP: TrackDef = {
  id: "ac_ship",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.22,
  voices: {
    ...pick(SYNTH.voices, ["ud", "nay", "kanun", "simsimiyya", "darb", "riq", "claps"]),
    vcd: { inst: "o.vc", gain: 0.11, pan: SEAT.vc, reverb: 0.3, poly: true, pattern: { kind: "drone", notes: [38, 45] } },
    va: chords("o.va", 0.06, SEAT.va, 0.4, 53, 69, 2),
    cbp: pulse("o.cb.pizz", 0.13, SEAT.cb, WET.low, bass("1 . . . 1 . . .", 33, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { drone: "vcd va", bass: "cbp" }),
  rest: SYNTH.rest,
};
