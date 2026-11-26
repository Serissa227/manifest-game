// 《黑潮》管弦版（日本的海，E 上的民谣音阶，4/4）：日本的乐器领奏
// （三味线、篠笛、尺八、太鼓、缔太鼓、拍子木——与合成版共用这些声部），
// 管弦只做衬底：第二小提琴与中提琴极轻的空五度长音，低音提琴一小节一个长音。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_KUROSHIO as SYNTH } from "../../tracks/seaKuroshio";
import { chords, pick, retarget, SEAT, WET } from "./kit";

export const SEA_KUROSHIO: TrackDef = {
  id: "sea_kuroshio",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.29,
  voices: {
    ...pick(SYNTH.voices, ["shami", "fue", "shaku", "taiko", "shime", "hyo"]),
    vn2: chords("o.vn", 0.05, SEAT.vn2, 0.46, 62, 76, 2),
    va: chords("o.va", 0.07, SEAT.va, 0.44, 52, 66, 2),
    cb: chords("o.cb", 0.12, SEAT.cb, WET.low, 26, 38, 1),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "vn2 va", low: "cb" }),
  rest: SYNTH.rest,
};
