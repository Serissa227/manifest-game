// 《湄南河的水市》管弦版：暹罗的 piphat 乐队领奏（孔旺艾、拉那·艾、拉那·通、皮奈、克卢伊、索乌、钦、塔蓬、格隆塔——与合成版共用这些声部），
// 管弦只做衬底：大提琴组与中提琴极轻的 G–D 空五度（暹罗音乐没有和弦，衬底只给一点空气）、高处小提琴更轻的 D–G，
// 低音提琴拨奏在两小节一圈的落点上点一下。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_SIAM as SYNTH } from "../../tracks/portSiam";
import { held, line, pick, retarget, SEAT, WET } from "./kit";

export const PORT_SIAM: TrackDef = {
  id: "port_siam",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["khong", "ranat", "thum", "pi", "khlui", "sawu", "ching", "taphon", "klong"]),
    vc: { ...held("o.vc", 0.1, SEAT.vc, WET.low), pattern: { kind: "drone", notes: [43, 50] } },
    va: { ...held("o.va", 0.06, SEAT.va, 0.44), pattern: { kind: "drone", notes: [55, 62] } },
    vn: { ...held("o.vn", 0.035, SEAT.vn2, 0.5), pattern: { kind: "drone", notes: [74, 79] } },
    cbp: line("o.cb.pizz", 0.22, SEAT.cb, WET.low),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "vc va vn", bass: "cbp" }),
  rest: SYNTH.rest,
  level: 1.2,
};
