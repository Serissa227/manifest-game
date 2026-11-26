// 《雪松与珊瑚》管弦版（奥斯曼与黎凡特的海岸——红海与海湾另有《星与三角帆》，见 seaArabic.ts；G 希贾兹，10/8 的阿克萨克 3 + 2 + 2 + 3）：
// 地方特色第二阶段重编——地方乐器领奏（布祖克琴、奈伊笛、爱琴海里拉琴、乌德琴、卡农琴、达布卡、里克鼓、本迪尔——与合成版共用这些声部），
// 管弦只做衬底：G–D 的持续音（引子与尾声）由大提琴组拉，空五度的长音是大提琴组与很轻的中提琴，大提琴组与低音提琴拨奏照阿克萨克的拍点走。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_LEVANT as SYNTH } from "../../tracks/seaLevant";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_LEVANT: TrackDef = {
  id: "sea_levant",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["buzuq", "nay", "lyra", "ud", "kanun", "darbuka", "riq", "bendir"]),
    pedal: { inst: "o.vc", gain: 0.14, pan: SEAT.vc, reverb: 0.3, poly: true, pattern: { kind: "drone", notes: [43, 50] } },
    vc: chords("o.vc", 0.1, SEAT.vc, WET.low, 43, 60, 2),
    va: chords("o.va", 0.07, SEAT.va, 0.4, 55, 67, 2),
    vcp: pulse("o.vc.pizz", 0.24, SEAT.vc, WET.low, bass("1 . . 5, . 1 . 5, . .", 48, 2)),
    cbp: pulse("o.cb.pizz", 0.18, SEAT.cb, WET.low, bass("1 . . . . 1 . . . .", 31, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { drone: "pedal", dem: "vc va", bass: "vcp cbp" }),
  rest: SYNTH.rest,
  level: 1,
};
