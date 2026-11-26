// 《闽海长风》管弦版（明的沿海，D 商调五声 4/4 的船工号子）：地方乐器领奏（曲笛、洞箫、二胡、笙、琵琶、三弦、扬琴、大锣、堂鼓、拍板——
// 与合成版共用这些声部），管弦只做衬底：大提琴组与低音提琴拨奏走低音（代替合成版的拨奏），笙奏长音的地方中提琴很轻地跟着同一组挂留和弦
// （两个音：根音与挂留音或五度）；B 段的南音没有笙，中提琴也跟着停。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
// 衬底的音量（10-11 复核）：第二遍衬底只比地方乐器低 6.5 dB，三个衬底声部各降 1 dB（0.26 / 0.18 / 0.07 → 0.23 / 0.16 / 0.062）。
import type { TrackDef } from "../../score";
import { SEA_MING as SYNTH } from "../../tracks/seaMing";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_MING: TrackDef = {
  id: "sea_ming",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["qudi", "xiao", "erhu", "chorus", "pipa", "sanxian", "yq", "arp", "sheng", "gong", "drum", "clap"]),
    vcp: pulse("o.vc.pizz", 0.23, SEAT.vc, WET.low, bass("1 . . . 5, . 1 .", 43, 2)),
    cbp: pulse("o.cb.pizz", 0.16, SEAT.cb, WET.low, bass("1 . . . 1 . 1 .", 26, 2)),
    va: chords("o.va", 0.062, SEAT.va, 0.4, 55, 67, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { bass: "vcp cbp", sheng: "sheng va" }),
  rest: SYNTH.rest,
  // 整体音量（10-11 复核）：南音段改轻（力度 0.5–0.54）以后整首轻了约 1 dB，1.23 → 1.33（两套编配一起改）
  level: 1.33,
};
