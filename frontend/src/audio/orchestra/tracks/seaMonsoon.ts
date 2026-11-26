// 《季风之路》管弦版（阿拉伯海与印度洋，D 利底亚 4/4，鼓按 3 + 3 + 2）。
// 地方特色第二阶段重编：地方乐器领奏（奈伊笛、乌德琴、卡曼恰、桑图尔、坦布拉、达布卡、陶罐、米尔瓦斯、拍手、里克鼓——与合成版共用这些声部），
// 管弦只做衬底：大提琴组拉 D–A 的持续音，中提琴很轻的空五度，大提琴组与低音提琴拨奏落在 3 + 3 + 2 的拍点上。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_MONSOON as SYNTH } from "../../tracks/seaMonsoon";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_MONSOON: TrackDef = {
  id: "sea_monsoon",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["nay", "ud", "kamancheh", "santur", "tanpura", "darb", "jahlah", "mirwas", "claps", "riq"]),
    vcd: { inst: "o.vc", gain: 0.13, pan: SEAT.vc, reverb: 0.3, poly: true, pattern: { kind: "drone", notes: [38, 45] } },
    va: chords("o.va", 0.08, SEAT.va, WET.strings, 55, 69, 2),
    vcp: pulse("o.vc.pizz", 0.17, SEAT.vc, WET.low, bass("1 . . 5, . . 1 .", 43, 2)),
    cbp: pulse("o.cb.pizz", 0.14, SEAT.cb, WET.low, bass("1 . . 1 . . 1 .", 26, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { drone: "vcd va", bass: "vcp cbp" }),
  rest: SYNTH.rest,
};
