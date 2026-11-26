// 《信风群岛》管弦版（南洋群岛，F 大调的五声旋律，6/8，暖、明亮、晃悠悠）：旋律与和声同合成版，按管弦乐重新配器。
// 长笛代替鼻笛领奏（低音区的气息正像鼻笛），重复时交给马林巴；四弦小吉他的“下 · 上 下 · 上”改成小提琴组拨奏的扫弦与竖琴；
// 大提琴组与低音提琴拨奏落在第一、四拍，沙锤一直沙沙地走，大鼓只在第一拍轻轻一下；
// B 段马林巴在下面配一条和声，中提琴与第二小提琴的和弦长音铺在后面，像信风吹过椰林；开头长笛吹起帆动机。
import type { TrackDef } from "../../score";
import { SEA_ISLANDS as SYNTH } from "../../tracks/seaIslands";
import { bass, chords, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const SEA_ISLANDS: TrackDef = {
  id: "sea_islands",
  title: SYNTH.title,
  qpm: 100,
  meter: [6, 8],
  key: "F major",
  voices: {
    fl: line("o.fl", 0.58, SEAT.fl, WET.winds),
    cl: line("o.cl", 0.46, SEAT.cl, WET.winds),
    mar: line("o.marimba", 0.44, SEAT.marimba, 0.28),
    strum: pulse("o.vn.pizz", 0.2, SEAT.vn2, WET.strings, { kind: "strum", low: 60, high: 76, steps: "D . u D . u", spread: 0.01 }),
    harp: pulse("o.harp", 0.22, SEAT.harp, WET.harp, { kind: "arp", low: 41, steps: "1 5 8 10 8 5", ring: 2 }),
    vn2: chords("o.vn", 0.12, SEAT.vn2, 0.36, 65, 77, 2),
    va: chords("o.va", 0.12, SEAT.va, 0.36, 57, 69, 2),
    vcp: pulse("o.vc.pizz", 0.4, SEAT.vc, WET.low, bass("1 . . 5 . .", 41, 2)),
    cbp: pulse("o.cb.pizz", 0.3, SEAT.cb, WET.low, bass("1 . . 1 . .", 29, 2)),
    shaker: pulse("o.perc", 0.3, -0.34, 0.18, { kind: "drum", steps: "Sss Sss", hits: { S: ["shaker", 0.5], s: ["shaker", 0.3] } }),
    bd: pulse("o.perc", 0.3, 0.05, 0.25, { kind: "drum", steps: "B..b..", hits: { B: ["bd", 0.4], b: ["bd", 0.22] } }),
  },
  sections: {
    intro: { ...S.intro },
    A: { ...S.A },
    B: { ...S.B },
    outro: { ...S.outro },
  },
  forms: [
    [
      { s: "intro", play: "motif:fl strum harp shaker bd", dyn: 0.56, to: 0.64 },
      { s: "A", play: "mel:fl strum vcp cbp shaker bd", dyn: 0.66 },
      { s: "A", play: "mel:mar strum harp vcp cbp shaker bd", dyn: 0.66 },
      { s: "B", play: "mel:fl harm:mar strum vcp cbp shaker bd va vn2", dyn: 0.68, to: 0.72 },
      { s: "B", play: "mel:mar harm:cl strum vcp cbp shaker bd va vn2", dyn: 0.7 },
      { s: "A", play: "mel:fl mel:mar strum harp vcp cbp shaker bd va vn2", dyn: 0.72 },
      { s: "outro", play: "tag:fl strum vcp cbp", dyn: 0.6, to: 0.4, rit: 0.85 },
    ],
    [
      { s: "intro", play: "motif:fl strum shaker", dyn: 0.52, to: 0.6 },
      { s: "A", play: "mel:mar strum vcp cbp shaker", dyn: 0.62 },
      { s: "A", play: "mel:fl strum harp vcp cbp shaker bd", dyn: 0.66 },
      { s: "B", play: "mel:fl harm:mar strum vcp cbp shaker bd va vn2", dyn: 0.68, to: 0.72 },
      { s: "B", play: "mel:fl mel:cl-12 strum vcp cbp shaker bd va vn2", dyn: 0.7 },
      { s: "A", play: "mel:fl mel:mar strum harp vcp cbp shaker bd va vn2", dyn: 0.72 },
      { s: "outro", play: "tag:mar strum vcp cbp", dyn: 0.58, to: 0.38, rit: 0.85 },
    ],
  ],
  rest: [25, 45],
};
