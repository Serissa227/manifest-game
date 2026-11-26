// 《酒色的海湾》管弦版：地方乐器领奏（布祖克琴、爱琴海里拉琴、卡农琴、奈伊笛、劳托琴、达布卡、里克鼓、里拉琴弓上的小铃——与合成版共用这些声部），
// 管弦只做衬底：大提琴组在低处拉 D–A 的空五度、中提琴很轻地跟着，大提琴组与低音提琴拨奏落在 3 + 2 + 2 的头上。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_LEVANT as SYNTH } from "../../tracks/portLevant";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_LEVANT: TrackDef = {
  id: "port_levant",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["buzuq", "lyra", "kanun", "nay", "laouto", "darbuka", "riq", "bells"]),
    vc: chords("o.vc", 0.12, SEAT.vc, WET.low, 45, 60, 2),
    va: chords("o.va", 0.07, SEAT.va, 0.4, 52, 69, 2),
    vcp: pulse("o.vc.pizz", 0.22, SEAT.vc, WET.low, bass("1 . . 5, . 1 .", 50, 2)),
    cbp: pulse("o.cb.pizz", 0.16, SEAT.cb, WET.low, bass("1 . . . . . .", 31, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { dem: "vc va", bass: "vcp cbp" }),
  rest: SYNTH.rest,
  level: 1.1,
};
