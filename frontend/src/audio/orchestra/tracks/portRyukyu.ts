// 《红瓦与三线》管弦版：地方乐器领奏（三线、胡弓、指笛、エイサーの太鼓、缔太鼓、手鼓、三板——与合成版共用这些声部），
// 管弦只做衬底：大提琴组在低处拉 C（偶尔 E、F）的长音，低音提琴拨奏落在每小节的两拍上（根音与五度，都在音阶里），
// 中提琴很轻的空五度，高处小提琴极轻地铺一层。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_RYUKYU as SYNTH } from "../../tracks/portRyukyu";
import { bass, chords, line, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_RYUKYU: TrackDef = {
  id: "port_ryukyu",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["sanshin", "kucho", "fue", "eisa", "shime", "paranku", "sanba"]),
    vc: line("o.vc", 0.13, SEAT.vc, WET.low, bass("1 . . . . .", 43, 6)),
    cbp: pulse("o.cb.pizz", 0.13, SEAT.cb, WET.low, bass("1 . . 5 . .", 31, 2)),
    va: chords("o.va", 0.07, SEAT.va, 0.4, 52, 67, 2),
    vn: chords("o.vn", 0.04, SEAT.vn2, 0.46, 72, 86, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "va vn", low: "vc cbp" }),
  rest: SYNTH.rest,
  level: 1.15,
};
