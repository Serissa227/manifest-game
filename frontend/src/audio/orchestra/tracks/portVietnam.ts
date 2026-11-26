// 《会安的河埠》管弦版：越南的丝竹领奏（独弦琴、檀筝、月琴、竹笛、拍板、木鱼、饭鼓——与合成版共用这些声部），
// 管弦只做衬底：大提琴组与中提琴极轻的 C–G 空五度、高处小提琴更轻的 C–G，低音提琴拨奏在句首点一下。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_VIETNAM as SYNTH } from "../../tracks/portVietnam";
import { held, line, pick, retarget, SEAT, WET } from "./kit";

export const PORT_VIETNAM: TrackDef = {
  id: "port_vietnam",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["bau", "tranh", "nguyet", "sao", "phach", "mo", "trong"]),
    vc: { ...held("o.vc", 0.1, SEAT.vc, WET.low), pattern: { kind: "drone", notes: [36, 43] } },
    va: { ...held("o.va", 0.06, SEAT.va, 0.44), pattern: { kind: "drone", notes: [55, 60] } },
    vn: { ...held("o.vn", 0.035, SEAT.vn2, 0.5), pattern: { kind: "drone", notes: [72, 79] } },
    cbp: line("o.cb.pizz", 0.2, SEAT.cb, WET.low),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "vc va vn", bass: "cbp" }),
  rest: SYNTH.rest,
  level: 1.4,
};
