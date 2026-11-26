// 《珍宝船队》管弦版（加勒比海与墨西哥湾，A 多利亚，6/8 与 3/4 叠着走）：西班牙大陆沿岸的乐器领奏
// （肖姆管、奇里米亚、中音竖笛、维奥尔琴、维韦拉琴的扫弦、沙槌、刮瓜、小鼓——与合成版共用这些声部），
// 管弦只做衬底：真的竖琴分解和弦，第二小提琴与中提琴很轻的和弦长音，大提琴组与低音提琴的拨奏。
// 曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_TREASURE as SYNTH } from "../../tracks/seaTreasure";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_TREASURE: TrackDef = {
  id: "sea_treasure",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["shawm", "chir", "reca", "gamba", "vstrum", "mara", "guiro", "tamb"]),
    harpp: pulse("o.harp", 0.2, SEAT.harp, WET.harp, { kind: "arp", low: 45, steps: "1 5 8 10 8 5", ring: 2 }),
    vn2: chords("o.vn", 0.06, SEAT.vn2, 0.4, 64, 76, 2),
    va: chords("o.va", 0.08, SEAT.va, 0.4, 55, 67, 2),
    vcp: pulse("o.vc.pizz", 0.2, SEAT.vc, WET.low, bass("1 . . 5 . .", 45, 2)),
    cbp: pulse("o.cb.pizz", 0.15, SEAT.cb, WET.low, bass("1 . . 1 . .", 28, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { hp: "harpp", pad: "vn2 va", pz: "vcp cbp" }),
  rest: SYNTH.rest,
};
