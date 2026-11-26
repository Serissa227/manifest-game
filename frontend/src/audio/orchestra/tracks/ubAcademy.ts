// 《课业与钟声》管弦版（养成篇的学院期，G 大调 4/4，轻快、有条理）：旋律与和声同合成版，按管弦乐重新配器。
// 开头管钟敲四下（学院的钟）；A 段单簧管吹那段跳跳的主题（断奏照旧），羽管键琴的扫弦改成小提琴组的拨奏和弦落在反拍，
// 大提琴组拨奏一拍一个；再来一遍时双簧管领、大管走四分音符的低音线，竖琴轻轻点和弦；
// B 段一问一答：大管在低处提问，长笛在高处回答，中提琴的和弦长音托着；重回主题时长笛与低八度的单簧管同奏。
// 木块是乐队的高木鼓，只在主题重来时轻轻点在第二、四拍。
import type { TrackDef } from "../../score";
import { UB_ACADEMY as SYNTH } from "../../tracks/ubAcademy";
import { bass, chords, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const UB_ACADEMY: TrackDef = {
  id: "ub_academy",
  title: SYNTH.title,
  qpm: 120,
  meter: [4, 4],
  key: "G major",
  level: 1.26,
  voices: {
    cl: line("o.cl", 0.5, SEAT.cl, WET.winds),
    ob: line("o.ob", 0.46, SEAT.ob, WET.winds),
    fl: line("o.fl", 0.48, SEAT.fl, WET.winds),
    bn: line("o.bn", 0.46, SEAT.bn, WET.winds),
    bell: line("o.tubular", 0.26, SEAT.bells, WET.bells),
    vnp: pulse("o.vn.pizz", 0.24, SEAT.vn2, WET.strings, bass("- - 8+10 - - - 8+10 -", 55)),
    vcp: pulse("o.vc.pizz", 0.34, SEAT.vc, WET.low, bass("1 . 5, . 1 . 5, .", 41, 2)),
    harp: pulse("o.harp", 0.2, SEAT.harp, WET.harp, { kind: "arp", low: 43, steps: "1 . 8 . 10 . 12 .", ring: 2 }),
    va: chords("o.va", 0.12, SEAT.va, WET.strings, 52, 66, 3),
    tick: pulse("o.perc", 0.24, -0.1, WET.perc, { kind: "drum", steps: "..w...w.", hits: { w: ["loghi", 0.28] } }),
  },
  sections: {
    intro: { ...S.intro },
    A: { ...S.A },
    B: { ...S.B },
    outro: { ...S.outro },
  },
  forms: [
    [
      { s: "intro", play: "bell:bell vcp", dyn: 0.6 },
      { s: "A", play: "mel:cl vnp vcp", dyn: 0.62 },
      { s: "A", play: "mel:ob walk:bn vnp vcp harp tick", dyn: 0.66 },
      { s: "B", play: "q:bn-12 a:fl va vcp", dyn: 0.62 },
      { s: "A", play: "mel:fl mel:cl-12 walk:bn vnp vcp harp tick", dyn: 0.66 },
      { s: "outro", play: "tag:cl bell:bell vnp vcp", dyn: 0.62, to: 0.5, rit: 0.85 },
    ],
    [
      { s: "intro", play: "bell:bell", dyn: 0.58 },
      { s: "A", play: "mel:fl vnp vcp", dyn: 0.62 },
      { s: "B", play: "q:bn-12 a:ob va vcp", dyn: 0.62 },
      { s: "B", play: "q:bn-12 a:fl va vnp vcp", dyn: 0.64 },
      { s: "A", play: "mel:cl walk:bn vnp vcp harp tick", dyn: 0.66 },
      { s: "outro", play: "tag:fl bell:bell vnp vcp", dyn: 0.62, to: 0.5, rit: 0.85 },
    ],
  ],
  rest: [8, 14],
};
