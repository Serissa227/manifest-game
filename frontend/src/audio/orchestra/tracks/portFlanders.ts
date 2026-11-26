// 《斯海尔德河的集市》管弦版：地方乐器领奏（风笛与持续音管、克鲁姆管三声部、钟楼的排钟、隆默尔罐、雇佣兵的长鼓——与合成版共用这些声部），
// 管弦只做衬底：大提琴组在低处拉 G 的长音、低音提琴拨奏落在一、三拍，中提琴很轻的空五度 / 三和弦，高处小提琴极轻地铺一层。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_FLANDERS as SYNTH } from "../../tracks/portFlanders";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_FLANDERS: TrackDef = {
  id: "port_flanders",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["pipe", "drones", "crum1", "crum2", "crum3", "bells", "hour", "rommel", "trom"]),
    vc: line("o.vc", 0.11, SEAT.vc, WET.low, bass("1 . . . . . . .", 43, 8)),
    cbp: pulse("o.cb.pizz", 0.12, SEAT.cb, WET.low, bass("1 . . . 5 . . .", 31, 2)),
    va: chords("o.va", 0.065, SEAT.va, 0.4, 52, 67, 2),
    vn: chords("o.vn", 0.035, SEAT.vn2, 0.46, 71, 86, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vn", low: "vc cbp" }),
  rest: SYNTH.rest,
  level: 1.4,
};
