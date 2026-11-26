// 《尤卡坦的信风》管弦版（加勒比与中美，B 小调 6/8 的六三交替）：地方乐器领奏（泰诺骨笛、玛雅陶笛、奇里米亚木管、海螺号、
// 马约瓦坎木鼓、马拉卡、刮瓜——与合成版共用这些声部），管弦只做衬底：竖琴照六三交替两小节一换地拨和弦（代替合成版的西班牙吉他），
// 大提琴组与低音提琴拨奏走低音，第二小提琴与中提琴很轻的和弦长音。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_CARIBBEAN as SYNTH } from "../../tracks/seaCaribbean";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_CARIBBEAN: TrackDef = {
  id: "sea_caribbean",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["bone", "ocarina", "chirimia", "conch", "slit", "maracas", "guiro"]),
    harp: pulse("o.harp", 0.09, SEAT.harp + 0.1, WET.harp, { kind: "arp", low: 47, steps: "1+5+8 - - 3+8 - - 1+5+8 - 3+8 - 1+5+8 -", ring: 2 }),
    vcp: pulse("o.vc.pizz", 0.14, SEAT.vc, WET.low, bass("1 . . 5, . . 1 . 5, . 8 .", 41, 2)),
    cbp: pulse("o.cb.pizz", 0.1, SEAT.cb, WET.low, bass("1 . . 1 . . 1 . 1 . 1 .", 28, 2)),
    vn2: chords("o.vn", 0.04, SEAT.vn2, WET.strings, 62, 74, 2),
    va: chords("o.va", 0.05, SEAT.va, WET.strings, 54, 66, 3),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { guitar: "harp", bass: "vcp cbp", strings: "vn2 va" }),
  rest: SYNTH.rest,
  level: 1.31,
};
