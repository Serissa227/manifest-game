// 《柯克船的号子》管弦版（北海与波罗的海，A 多利亚 4/4 的绞盘号子）：地方特色第二阶段重编——
// 地方乐器领奏（尼克尔哈帕领号、克鲁姆管低八度跟着、风笛与持续音管吼副歌、山羊角号吹起帆动机、跺脚与雇佣兵的长鼓——与合成版共用这些声部），
// 管弦只做衬底：长号与低音提琴在低处齐声（副歌的低声部），第二小提琴与中提琴很轻的和弦长音，大提琴组与低音提琴拨奏落在一、三拍，
// 开头与结尾管钟低沉的一响（船钟）。用大厅混响。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_HANSA as SYNTH } from "../../tracks/seaHansa";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_HANSA: TrackDef = {
  id: "sea_hansa",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  hall: true,
  voices: {
    ...pick(SYNTH.voices, ["nyck", "crum", "pipe", "drones", "horn", "stomp", "trom"]),
    tb: line("o.tb", 0.15, SEAT.tb, WET.brass),
    cbl: line("o.cb", 0.11, SEAT.cb, 0.22),
    vn2: chords("o.vn", 0.05, SEAT.vn2, WET.strings, 62, 74, 2),
    va: chords("o.va", 0.06, SEAT.va, WET.strings, 52, 66, 3),
    vcp: pulse("o.vc.pizz", 0.13, SEAT.vc, WET.low, bass("1 . . . 5, . . .", 41, 3)),
    cbp: pulse("o.cb.pizz", 0.12, SEAT.cb, WET.low, bass("1 . . . 1 . . .", 28, 3)),
    tub: line("o.tubular", 0.2, SEAT.bells, WET.bells),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { strings: "vn2 va", choir: "", bass: "vcp cbp", low: "tb cbl", bell: "tub" }),
  rest: SYNTH.rest,
  level: 1.18,
};
