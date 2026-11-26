// 《潮待之海》管弦版（日本的内海与南海路，D 上的阳音阶 / 阴音阶，慢 4/4、留白多）：地方乐器领奏
// （尺八、筝、三味线、能管、太鼓、拍子木、小鼓与大鼓、缔太鼓——与合成版共用这些声部），
// 管弦只做衬底：第二小提琴与中提琴极轻的空五度长音，低音提琴一小节一个长音（代替合成版的持续音与弦乐群）。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_JAPAN as SYNTH } from "../../tracks/seaJapan";
import { chords, pick, retarget, SEAT, WET } from "./kit";

export const SEA_JAPAN: TrackDef = {
  id: "sea_japan",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  space: SYNTH.space,
  voices: {
    ...pick(SYNTH.voices, ["shaku", "koto", "arp", "shami", "nohkan", "taiko", "hyo", "noh", "shime"]),
    vn2: chords("o.vn", 0.05, SEAT.vn2, 0.46, 64, 79, 2),
    va: chords("o.va", 0.07, SEAT.va, 0.44, 55, 67, 2),
    cb: chords("o.cb", 0.12, SEAT.cb, WET.low, 26, 38, 1),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "vn2 va", low: "cb" }),
  rest: SYNTH.rest,
  level: 1.33,
};
