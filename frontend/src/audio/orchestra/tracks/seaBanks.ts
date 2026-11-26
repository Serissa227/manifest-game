// 《大浅滩的鳕鱼船》管弦版（北大西洋的西北角，G 大调 5/8，巴斯克的索尔齐科与布列塔尼的一唱一和）：渔船上的乐器领奏
// （三孔笛与它的小鼓、雷贝克琴、肖姆管、法兰西风笛与持续音管、班多拉琴——与合成版共用这些声部），
// 管弦只做衬底：第二小提琴与中提琴很轻的和弦长音，大提琴组与低音提琴的拨奏。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_BANKS as SYNTH } from "../../tracks/seaBanks";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_BANKS: TrackDef = {
  id: "sea_banks",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.29,
  voices: {
    ...pick(SYNTH.voices, ["pipe", "reb", "shawm", "corn", "dr", "band", "tamb"]),
    vn2: chords("o.vn", 0.06, SEAT.vn2, 0.4, 62, 76, 2),
    va: chords("o.va", 0.08, SEAT.va, 0.4, 52, 67, 2),
    vcp: pulse("o.vc.pizz", 0.2, SEAT.vc, WET.low, bass("1 . . 5 .", 43, 2)),
    cbp: pulse("o.cb.pizz", 0.15, SEAT.cb, WET.low, bass("1 . . . .", 31, 3)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "vn2 va", pz: "vcp cbp" }),
  rest: SYNTH.rest,
};
