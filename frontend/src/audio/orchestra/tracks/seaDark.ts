// 《黑暗之海》管弦版（大西洋深处的雾，C 上的八音音阶，5/4）：旋律与和声同合成版，按管弦乐重新配器。
// 大提琴组守着 C 与升 F 的三全音；高处小提琴组极轻的颤弓和弦像泛音一样悬着；A 段单簧管在低音区唱（再来时圆号低八度跟着），
// B 段第一小提琴在高处唱，中提琴与第二小提琴的和弦长音代替人声；钟琴与竖琴偶尔一点冷光，管钟是远处的雾钟（还原 A）；
// 开头一声很轻的大锣、定音鼓在 C 上滚奏，圆号吹起走歪了的起帆动机（G → C → 升 F）。用大厅混响。
import type { TrackDef } from "../../score";
import { SEA_DARK as SYNTH } from "../../tracks/seaDark";
import { chords, line, SEAT } from "./kit";

const S = SYNTH.sections;

export const SEA_DARK: TrackDef = {
  id: "sea_dark",
  title: SYNTH.title,
  qpm: 56,
  meter: [5, 4],
  key: "C minor",
  hall: true,
  space: 1.35,
  level: 1.2,
  voices: {
    cl: line("o.cl", 0.5, SEAT.cl, 0.55),
    vn1: line("o.vn", 0.46, SEAT.vn1, 0.6),
    hn: line("o.hn", 0.44, SEAT.hn, 0.6),
    glock: line("o.glock", 0.12, SEAT.glock, 0.75),
    hp: line("o.harp", 0.22, SEAT.harp, 0.7),
    bell: line("o.tubular", 0.22, SEAT.bells, 0.8),
    gong: line("o.perc", 0.3, 0.1, 0.8),
    timp: line("o.timp", 0.3, SEAT.timp, 0.6),
    trem: chords("o.vn.trem", 0.08, SEAT.vn2, 0.65, 76, 88, 3),
    va: chords("o.va", 0.1, SEAT.va, 0.6, 57, 69, 3),
    vn2: chords("o.vn", 0.08, SEAT.vn2, 0.6, 64, 76, 2),
    drone: { inst: "o.vc", gain: 0.18, pan: SEAT.vc, reverb: 0.5, poly: true, pattern: { kind: "drone", notes: [36, 42] } },
  },
  sections: {
    intro: { ...S.intro, lines: { motif: S.intro.lines!.motif, gong: "g10 | z10", timp: "!trem!C,10 | z10" } },
    A: { ...S.A },
    B: { ...S.B },
    outro: { ...S.outro },
  },
  forms: [
    [
      { s: "intro", play: "gong:gong timp:timp motif:hn drone trem", dyn: 0.5, to: 0.56 },
      { s: "A", play: "mel:cl bell:bell glint:glock glint:hp-12 drone trem", dyn: 0.58 },
      { s: "B", play: "bmel:vn1 glint:glock glint:hp-12 va vn2 drone", dyn: 0.6, to: 0.64 },
      { s: "A", play: "mel:cl mel:hn-12 bell:bell glint:glock glint:hp-12 drone trem va", dyn: 0.6 },
      { s: "outro", play: "motif:hn bell:bell drone trem", dyn: 0.52, to: 0.36, rit: 0.85 },
    ],
    [
      { s: "intro", play: "gong:gong motif:hn drone", dyn: 0.48, to: 0.54 },
      { s: "B", play: "bmel:vn1 glint:glock glint:hp-12 va vn2 drone", dyn: 0.58, to: 0.62 },
      { s: "A", play: "mel:cl bell:bell glint:glock glint:hp-12 drone trem", dyn: 0.6 },
      { s: "outro", play: "motif:hn bell:bell drone trem", dyn: 0.5, to: 0.34, rit: 0.85 },
    ],
  ],
  rest: [30, 50],
};
