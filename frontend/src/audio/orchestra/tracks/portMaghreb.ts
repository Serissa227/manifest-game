// 《萨累的海门》管弦版：地方乐器领奏（拉巴卜、乌德琴、奈伊笛、金布里琴与拍皮、卡拉卡布铁响板、拍手、达布卡、小框鼓——与合成版共用这些声部），
// 管弦只做衬底、只在安达卢斯的努巴里：大提琴组在低处拉 D 的长音，低音提琴每小节很轻地拨一下、大提琴组在第四拍轻轻拨 D 与 A，中提琴很轻的 D–A 空五度；格纳瓦的两段没有管弦。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_MAGHREB as SYNTH } from "../../tracks/portMaghreb";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_MAGHREB: TrackDef = {
  id: "port_maghreb",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["rabab", "ud", "nay", "gimbri", "gslap", "qraqeb", "claps", "darb", "tar"]),
    vc: line("o.vc", 0.14, SEAT.vc, WET.low, bass("1 . . . . .", 38, 6)),
    cbp: pulse("o.cb.pizz", 0.16, SEAT.cb, WET.low, bass("1 . . . . .", 33, 3)),
    vcp: pulse("o.vc.pizz", 0.13, SEAT.vc, WET.low, bass("- - - 1 . . - - - 5, . .", 41, 2)),
    va: chords("o.va", 0.08, SEAT.va, 0.42, 50, 69, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { dem: "va vc", bass: "cbp vcp" }),
  rest: SYNTH.rest,
  level: 1.1,
};
