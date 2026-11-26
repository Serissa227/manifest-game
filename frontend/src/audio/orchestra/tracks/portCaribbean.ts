// 《岛上的阿雷伊托》管弦版：泰诺的乐器领奏（骨笛、两支陶笛、海螺号、马约瓦坎木鼓、马拉卡、刮瓜——与合成版共用这些声部），
// 管弦只做衬底：竖琴很轻地拨“三 + 三 + 二”的空五度（代替合成版的西班牙吉他），大提琴组拨奏跟着木鼓的低舌，中提琴很轻的空五度长音。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { PORT_CARIBBEAN as SYNTH } from "../../tracks/portCaribbean";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const PORT_CARIBBEAN: TrackDef = {
  id: "port_caribbean",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["lead", "chorus", "chorus2", "conch", "slit", "rim", "maracas", "guiro"]),
    harp: pulse("o.harp", 0.12, SEAT.harp, WET.harp, { kind: "arp", low: 53, steps: "1+5 - - 1+5 - - 1+5 -", ring: 2 }),
    vcp: pulse("o.vc.pizz", 0.15, SEAT.vc, WET.low, bass("1 . . 1 . . 5, .", 41, 2)),
    va: chords("o.va", 0.07, SEAT.va, 0.4, 53, 67, 2),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { guitar: "harp", pad: "va vcp" }),
  rest: SYNTH.rest,
  level: 1.3,
};
