// 《盐砖与乳香》管弦版：埃塞俄比亚的乐器领奏（克拉尔琴、马森果、瓦辛特笛、贝格纳琴、凯贝罗鼓、拍手、叉铃——与合成版共用这些声部），
// 管弦只做衬底：大提琴组在低处拉主音 E 的长音、低音提琴拨奏落在每小节的头上；中提琴与高处的小提琴极轻地拉 E 的八度
// （安奇霍耶里没有纯五度），只有提兹塔的 B 段加上 B。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef, VoiceDef } from "../../score";
import { PORT_ETHIOPIA as SYNTH } from "../../tracks/portEthiopia";
import { line, pick, retarget, SEAT, WET } from "./kit";

/** 持续音的声部：a 为安奇霍耶（只有八度），b 为提兹塔（加上五度）。 */
function drone(inst: string, gain: number, pan: number, a: number[], b: number[]): VoiceDef {
  return { inst, gain, pan, reverb: 0.4, poly: true, pattern: { a: { kind: "drone", notes: a }, b: { kind: "drone", notes: b } } };
}

export const PORT_ETHIOPIA: TrackDef = {
  id: "port_ethiopia",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["krar", "krar2", "masenqo", "washint", "begena", "kebero", "clap", "tsen"]),
    vc: line("o.vc", 0.16, SEAT.vc, WET.low),
    cbp: line("o.cb.pizz", 0.16, SEAT.cb, WET.low),
    va: drone("o.va", 0.09, SEAT.va, [52, 64], [52, 59]),
    vn: drone("o.vn", 0.05, SEAT.vn2, [64, 76], [71, 76]),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { low: "vc cbp", pad: "va vn" }),
  rest: SYNTH.rest,
  level: 1.12,
};
