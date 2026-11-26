// 《群岛的夏风》管弦版（爱琴海与黎凡特的海，E 希贾兹，4/4 里的 3 + 3 + 2）：爱琴海与黎凡特的乐器领奏
// （里拉琴、奈伊笛、卡农琴、劳托琴的扫弦、达布卡、本迪尔框鼓——与合成版共用这些声部），
// 管弦只做衬底：大提琴与中提琴极轻的空五度长音，大提琴组与低音提琴的拨奏。曲式、段落与合成版一模一样（retarget 只换衬底的声部）。
import type { TrackDef } from "../../score";
import { SEA_AEGEAN as SYNTH } from "../../tracks/seaAegean";
import { bass, chords, pick, pulse, retarget, SEAT, WET } from "./kit";

export const SEA_AEGEAN: TrackDef = {
  id: "sea_aegean",
  title: SYNTH.title,
  qpm: SYNTH.qpm,
  meter: SYNTH.meter,
  key: SYNTH.key,
  voices: {
    ...pick(SYNTH.voices, ["lyra", "nay", "kanun", "lstrum", "darb", "bend"]),
    vc: chords("o.vc", 0.07, SEAT.vc, 0.4, 40, 55, 1),
    va: chords("o.va", 0.07, SEAT.va, 0.42, 52, 64, 2),
    vcp: pulse("o.vc.pizz", 0.2, SEAT.vc, WET.low, bass("1 . . 1 . . 5 .", 40, 2)),
    cbp: pulse("o.cb.pizz", 0.15, SEAT.cb, WET.low, bass("1 . . . . . 1 .", 28, 2)),
  },
  sections: SYNTH.sections,
  forms: retarget(SYNTH.forms, { drone: "vc va", pz: "vcp cbp" }),
  rest: SYNTH.rest,
};
