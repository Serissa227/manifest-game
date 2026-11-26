// 《乳香与咖啡的码头》管弦版：地方乐器领奏（乌德琴、卡农琴、奈伊笛、卡曼恰、两支米兹玛尔、西姆西米亚琴、里克鼓、达布卡、塔布勒大鼓、米尔瓦斯、陶罐、拍手——与合成版共用这些声部），
// 管弦只做衬底：大提琴组在低处拉 C 的长音，低音提琴拨奏落在“咚”上（马克苏姆、萨马伊的 10/8、萨伊迪、海湾的 3 + 3 + 2 各一种），中提琴很轻的空五度。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_ARABIA as SYNTH } from "../../tracks/portArabia";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_ARABIA: TrackDef = {
  id: "port_arabia",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["ud", "kanun", "nay", "kamancheh", "mizmar", "mizmar2", "simsimiyya", "riq", "darb", "tabl", "mirwas", "jahlah", "claps"]),
    vc: line("o.vc", 0.14, SEAT.vc, WET.low, bass("1 . . . . . . .", 36, 8)),
    cbp: pulse("o.cb.pizz", 0.2, SEAT.cb, WET.low, {
      maqsum: bass("1 . . . 1 . . .", 33, 2),
      samai: bass("1 . . . . 1 1 . . .", 33, 2),
      saidi: bass("1 . . 1 1 . . .", 33, 2),
      khaliji: bass("1 . . 1 . . 1 .", 33, 2),
    }),
    va: chords("o.va", 0.08, SEAT.va, 0.4, 52, 69, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { dem: "va vc", bass: "cbp" }),
  rest: SYNTH.rest,
  level: 1.1,
};
