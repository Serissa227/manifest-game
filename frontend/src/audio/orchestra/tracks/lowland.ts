// 《风车与账簿》管弦版（范德兰联省的港口，低地风；F 大调 4/4 的文艺复兴式圆舞）：旋律与和声同合成版，按管弦乐重新配器。
// 开头钟楼的排钟：管钟敲第一句，钟琴在高两个八度处轻轻叠着；竖笛的旋律改成长笛，次中音竖笛的和声是单簧管；
// 鲁特琴的分解和弦是竖琴，羽管键琴的扫弦是小提琴组的拨奏，维奥尔琴的低音是大管（大提琴组拨奏叠着），塔博鼓是轻轻的军鼓。
import type { TrackDef } from "../../score";
import { LOWLAND as SYNTH } from "../../tracks/lowland";
import { bass, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const LOWLAND: TrackDef = {
  id: "port_lowland",
  title: SYNTH.title,
  qpm: 116,
  meter: [4, 4],
  key: "F major",
  voices: {
    fl: line("o.fl", 0.54, SEAT.fl, 0.28),
    cl: line("o.cl", 0.4, SEAT.cl, 0.28),
    ob: line("o.ob", 0.42, SEAT.ob, 0.28),
    hp: line("o.harp", 0.44, SEAT.harp, 0.28),
    harp: pulse("o.harp", 0.22, SEAT.harp, WET.harp, { kind: "arp", low: 43, steps: "1 5 8 10 8 5 8 10", ring: 2 }),
    strum: pulse("o.vn.pizz", 0.18, SEAT.vn2, 0.22, { kind: "strum", low: 55, high: 72, steps: "D . d . D . d .", spread: 0.02 }),
    bn: line("o.bn", 0.4, SEAT.bn, 0.24, bass("1 . . . 5 . . .", 41)),
    vcp: pulse("o.vc.pizz", 0.3, SEAT.vc, WET.low, bass("1 . . . 5 . . .", 41, 2)),
    tabor: pulse("o.perc", 0.26, -0.05, 0.22, { kind: "drum", steps: "X.xxX.x.", hits: { X: ["snare", 0.4], x: ["snare", 0.22] } }),
    bells: line("o.tubular", 0.3, SEAT.bells, 0.6),
    glock: line("o.glock", 0.12, SEAT.glock, 0.6),
  },
  sections: {
    bells: { ...S.bells },
    A: { ...S.A },
    B: { ...S.B },
  },
  forms: [
    [
      { s: "bells", play: "car:bells car:glock+24", dyn: 0.7 },
      { s: "A", play: "mel:fl harp bn vcp tabor", dyn: 0.66 },
      { s: "A", play: "mel:fl harm:cl strum harp bn vcp tabor", dyn: 0.72 },
      { s: "B", play: "mel:fl strum bn vcp tabor", dyn: 0.72 },
      { s: "B", play: "mel:fl mel:ob harm:cl strum harp bn vcp tabor", dyn: 0.76, rit: 0.9 },
    ],
    [
      { s: "A", play: "mel:hp strum bn", dyn: 0.62 },
      { s: "A", play: "mel:fl harm:cl harp bn vcp tabor", dyn: 0.7 },
      { s: "B", play: "mel:ob strum harp bn vcp tabor", dyn: 0.72 },
      { s: "B", play: "mel:fl harm:cl strum bn vcp tabor", dyn: 0.76, rit: 0.9 },
    ],
  ],
  rest: [10, 18],
};
