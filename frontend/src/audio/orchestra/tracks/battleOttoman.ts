// 《新月的战鼓》管弦版：梅赫特的地方乐器领奏（祖尔纳、卡巴祖尔纳、博鲁号、克斯大鼓、纳卡雷、达乌尔、齐尔、杰夫根——与合成版共用这些声部），
// 管弦只做衬底：大提琴组在低处拉 D–A 的空五度、中提琴很轻地跟着，低音提琴拨奏落在克斯的“轰”上；
// 泰斯利姆里长号很轻的空五度，交锋与泰斯利姆里大提琴组用跳弓的八分音符往前推。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { BATTLE_OTTOMAN as SYNTH } from "../../tracks/battleOttoman";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const BATTLE_OTTOMAN: TrackDef = {
  id: "battle_ottoman",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["zurna", "kaba", "boru", "kos", "nakkare", "davul", "zil", "cevgen"]),
    vc: chords("o.vc", 0.09, SEAT.vc, WET.low, 38, 57, 2),
    va: chords("o.va", 0.055, SEAT.va, 0.36, 50, 64, 2),
    cbp: pulse("o.cb.pizz", 0.15, SEAT.cb, WET.low, bass("1 . . . 1 . . .", 26, 2)),
    vcs: pulse("o.vc.spic", 0.12, SEAT.vc, 0.2, bass("1 1 1 1 1 1 1 1", 38)),
    tb: chords("o.tb", 0.06, SEAT.tb, WET.brass, 45, 57, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { dem: "vc va", bass: "cbp", drive: "vcs cbp", hbed: "tb" }),
  rest: SYNTH.rest,
  level: 1.12,
};
