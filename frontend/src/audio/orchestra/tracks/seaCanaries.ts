// 《加那利的顺风》管弦版（伊比利亚外海与大西洋群岛，D 大调 6/8，加那利舞）：伊比利亚的乐器领奏
// （中音竖笛、肖姆管、短号、维奥尔琴、三孔笛与塔博鼓、维韦拉琴的扫弦、巴洪管、响板、阿杜菲方鼓——与合成版共用这些声部），
// 管弦只做衬底：第二小提琴与中提琴很轻的和弦长音，大提琴组与低音提琴拨奏落在第一、四拍。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_CANARIES as SYNTH } from "../../tracks/seaCanaries";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_CANARIES: TrackDef = {
  id: "sea_canaries",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.11,
  voices: {
    ...pick(SYNTH.voices, ["reca", "shawm", "cornett", "gamba", "pipe", "vstrum", "bajon", "cast", "adufe", "tabor"]),
    vn2: chords("o.vn", 0.06, SEAT.vn2, 0.4, 64, 76, 2),
    va: chords("o.va", 0.08, SEAT.va, 0.4, 55, 67, 2),
    vcp: pulse("o.vc.pizz", 0.22, SEAT.vc, WET.low, bass("1 . . 5, . .", 45, 2)),
    cbp: pulse("o.cb.pizz", 0.16, SEAT.cb, WET.low, bass("1 . . 1 . .", 28, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "vn2 va", pz: "vcp cbp" }),
  rest: SYNTH.rest,
};
