// 《子夜的征兆》管弦版（养成篇的事件 · 神秘，E 弗里吉亚慢 4/4）：旋律与和声同合成版，按管弦乐重新配器。
// 大提琴组守着 E–B 的空五度，低音提琴在 E 上；高处小提琴组极轻的颤弓和弦是夜里的冷光；长笛在低音区唱那条咏唱的旋律
// （再来时圆号低八度同奏，像远处有人跟着念）；钟琴与竖琴同奏三个音的征兆；B 段离开持续音，圆号唱、中提琴与第二小提琴的和弦长音托着，
// 最后落在 B 大三和弦上（圆号低八度唱，避开它高处的音域）；开头一声很轻的大锣，定音鼓在 E 上滚奏。用大厅混响。
import type { TrackDef } from "../../score";
import { UB_MYSTIC as SYNTH } from "../../tracks/ubMystic";
import { chords, line, SEAT } from "./kit";

const S = SYNTH.sections;

export const UB_MYSTIC: TrackDef = {
  id: "ub_mystic",
  title: SYNTH.title,
  qpm: 60,
  meter: [4, 4],
  key: "E phrygian",
  space: 1.25,
  hall: true,
  level: 1.08,
  voices: {
    fl: line("o.fl", 0.52, SEAT.fl, 0.5),
    hn: line("o.hn", 0.44, SEAT.hn, 0.5),
    glock: line("o.glock", 0.14, SEAT.glock, 0.66),
    hp: line("o.harp", 0.3, SEAT.harp, 0.6),
    trem: chords("o.vn.trem", 0.09, SEAT.vn2, 0.6, 67, 84, 3),
    va: chords("o.va", 0.11, SEAT.va, 0.5, 55, 69, 3),
    vn2: chords("o.vn", 0.09, SEAT.vn2, 0.5, 64, 76, 2),
    drone: { inst: "o.vc", gain: 0.17, pan: SEAT.vc, reverb: 0.4, poly: true, pattern: { kind: "drone", notes: [40, 47] } },
    cb: chords("o.cb", 0.15, SEAT.cb, 0.3, 28, 40, 1),
    timp: line("o.timp", 0.34, SEAT.timp, 0.5),
    gong: line("o.perc", 0.3, 0.1, 0.7),
  },
  sections: {
    intro: { ...S.intro, lines: { omen: S.intro.lines!.omen, timp: S.intro.lines!.timp, gong: "g8 | z8" } },
    A: { ...S.A },
    B: { ...S.B },
    outro: { ...S.outro },
  },
  forms: [
    [
      { s: "intro", play: "gong:gong timp:timp omen:glock omen:hp drone cb trem", dyn: 0.5, to: 0.56 },
      { s: "A", play: "mel:fl omen:glock omen:hp drone cb trem", dyn: 0.58 },
      { s: "B", play: "bmel:hn-12 omen:glock omen:hp timp:timp va vn2 cb", dyn: 0.6, to: 0.66 },
      { s: "A", play: "mel:fl mel:hn-12 omen:glock omen:hp drone cb trem va", dyn: 0.6 },
      { s: "outro", play: "tag:fl omen:glock omen:hp drone cb trem", dyn: 0.52, to: 0.36, rit: 0.85 },
    ],
    [
      { s: "intro", play: "gong:gong omen:glock omen:hp drone", dyn: 0.48, to: 0.54 },
      { s: "A", play: "mel:hn-12 omen:glock omen:hp drone cb trem", dyn: 0.56 },
      { s: "B", play: "bmel:fl omen:glock omen:hp timp:timp va vn2 cb", dyn: 0.6, to: 0.66 },
      { s: "A", play: "mel:fl omen:glock omen:hp drone cb trem va", dyn: 0.58 },
      { s: "outro", play: "tag:fl omen:glock omen:hp drone cb trem", dyn: 0.5, to: 0.34, rit: 0.85 },
    ],
  ],
  rest: [8, 14],
};
