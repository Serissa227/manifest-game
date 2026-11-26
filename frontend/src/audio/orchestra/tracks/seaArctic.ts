// 《白海的北风》管弦版：地方乐器领奏（尼克尔哈帕、山羊角号、古多克、古斯里琴、风笛的持续音管、罗斯的小钟、框鼓——与合成版共用这些声部），
// 管弦只做衬底：大提琴组一小节一个长音的低音、低音提琴守着 D，中提琴很轻的和弦长音（代替合成版的人声），
// 高处小提琴组极轻的颤弓拉着 A 与 E 的空五度，冷得发亮。用大厅混响。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_ARCTIC as SYNTH } from "../../tracks/seaArctic";
import { chords, held, line, pick, retarget, SEAT } from "./kit";

export const SEA_ARCTIC: TrackDef = {
  id: "sea_arctic",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  hall: true,
  voices: {
    ...pick(SYNTH.voices, ["nyck", "horn", "gudok", "gusli", "drones", "bells", "drum"]),
    vcl: line("o.vc", 0.16, SEAT.vc, 0.3, { kind: "arp", low: 38, steps: "b . . . . ." }),
    cb: { inst: "o.cb", gain: 0.14, pan: SEAT.cb, reverb: 0.24, poly: true, pattern: { kind: "drone", notes: [38] } },
    va: chords("o.va", 0.09, SEAT.va, 0.42, 55, 69, 3),
    ice5: { ...held("o.vn.trem", 0.07, SEAT.vn2, 0.5), pattern: { kind: "drone", notes: [69, 76] } },
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { celli: "vcl cb", choir: "va ice5" }),
  rest: SYNTH.rest,
  level: 0.94,
};
