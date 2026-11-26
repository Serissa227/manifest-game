// 《夏祭的囃子》管弦版（养成篇的节日·日本，A 阳音阶 4/4 的祭囃子）：地方乐器领奏（篠笛、三味线、当钲、缔太鼓、太鼓、拍子木——
// 与合成版共用这些声部），管弦只做衬底：大提琴组在低处拉 A，中提琴极轻的 A–E 空五度，低音提琴与大提琴组拨奏落在句首（代替合成版的拨奏）。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { UB_MATSURI as SYNTH } from "../../tracks/ubMatsuri";
import { line, pick, retarget, SEAT, WET } from "./kit";

export const UB_MATSURI: TrackDef = {
  id: "ub_matsuri",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["fue", "shami", "kane", "shime", "taiko", "hyo"]),
    vc: { inst: "o.vc", gain: 0.09, pan: SEAT.vc, reverb: WET.low, poly: true, pattern: { kind: "drone", notes: [45] } },
    va: { inst: "o.va", gain: 0.05, pan: SEAT.va, reverb: 0.4, poly: true, pattern: { kind: "drone", notes: [57, 64] } },
    cbp: line("o.cb.pizz", 0.22, SEAT.cb, WET.low),
    vcp: line("o.vc.pizz", 0.16, SEAT.vc, WET.low),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { bed: "vc va", thud: "cbp vcp" }),
  rest: SYNTH.rest,
  level: 1.1,
};
