// 《市政厅的号手》管弦版（北方与中欧的城镇的第二首，F 大调 4/4）：城市号手的乐器领奏
// （短号、两支克鲁姆管、肖姆管、萨克布的低音、簧管风琴的长音、市政厅的排钟、长鼓——与合成版共用这些声部），
// 管弦只做衬底：第二小提琴与中提琴很轻的和弦长音，大提琴组与低音提琴的拨奏。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_TOWN as SYNTH } from "../../tracks/portTown";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_TOWN: TrackDef = {
  id: "port_town",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  level: 1.38,
  voices: {
    ...pick(SYNTH.voices, ["corn", "crum", "crum2", "shawm", "sack", "regal", "bells", "trom"]),
    vn2: chords("o.vn", 0.06, SEAT.vn2, 0.4, 62, 76, 2),
    va: chords("o.va", 0.08, SEAT.va, 0.4, 53, 67, 2),
    vcp: pulse("o.vc.pizz", 0.2, SEAT.vc, WET.low, bass("1 . . . 5 . . .", 41, 2)),
    cbp: pulse("o.cb.pizz", 0.15, SEAT.cb, WET.low, bass("1 . . . . . . .", 29, 3)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { pad: "vn2 va", pz: "vcp cbp" }),
  rest: SYNTH.rest,
};
