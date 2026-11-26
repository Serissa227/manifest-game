// 《珊瑚潮》管弦版（马纳瓦群岛议会的港口，群岛风；C 大调五声旋律，4/4，悠闲）：旋律与和声同合成版，按管弦乐重新配器。
// 鼻笛的旋律交给长笛（句中的切分照旧），马林巴在重复时走下方三度；四弦小吉他“下 · 下上 · 上下上”的扫弦是小提琴组的拨奏；
// 大提琴组与低音提琴拨奏落在第一、三拍，大鼓轻轻地跟着，沙锤走八分音符，B 段加上木鼓与响棒的十六分音符花样；
// 中提琴与第二小提琴很轻的和弦长音铺在后面。
import type { TrackDef } from "../../score";
import { ISLANDS as SYNTH } from "../../tracks/islands";
import { bass, chords, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const ISLANDS: TrackDef = {
  id: "port_islands",
  title: SYNTH.title,
  qpm: 92,
  meter: [4, 4],
  key: "C major",
  voices: {
    fl: line("o.fl", 0.56, SEAT.fl, 0.32),
    mar: line("o.marimba", 0.5, SEAT.marimba, 0.28),
    strum: pulse("o.vn.pizz", 0.22, SEAT.vn2, 0.2, { kind: "strum", low: 60, high: 76, steps: "D . D U . U D U", spread: 0.009 }),
    harp: pulse("o.harp", 0.2, SEAT.harp, WET.harp, { kind: "arp", low: 48, steps: "1 5 8 10 12 10 8 5", ring: 2 }),
    vn2: chords("o.vn", 0.11, SEAT.vn2, 0.34, 64, 76, 2),
    va: chords("o.va", 0.11, SEAT.va, 0.34, 55, 67, 2),
    vcp: pulse("o.vc.pizz", 0.42, SEAT.vc, WET.low, bass("1 . . . 5 . . .", 36, 3)),
    cbp: pulse("o.cb.pizz", 0.3, SEAT.cb, WET.low, bass("1 . . . 1 . . .", 28, 3)),
    pahu: pulse("o.perc", 0.28, 0.05, 0.25, { kind: "drum", steps: "P...p...", hits: { P: ["bd", 0.46], p: ["bd", 0.26] } }),
    shaker: pulse("o.perc", 0.34, -0.35, 0.15, { kind: "drum", steps: "sSsSsSsS", hits: { s: ["shaker", 0.35], S: ["shaker", 0.55] } }),
    logs: pulse("o.perc", 0.3, 0.4, 0.2, { kind: "drum", grid: 0.5, steps: "X.xx.x.xX.xx.xx.", hits: { X: ["loghi", 0.5], x: ["claves", 0.26] } }),
  },
  sections: {
    intro: { ...S.intro },
    A: { ...S.A },
    B: { ...S.B },
  },
  forms: [
    [
      { s: "intro", play: "strum shaker", dyn: 0.6 },
      { s: "A", play: "mel:fl strum vcp cbp pahu shaker", dyn: 0.64 },
      { s: "A", play: "mel:mar strum vcp cbp pahu shaker va", dyn: 0.66 },
      { s: "B", play: "mel:fl strum harp vcp cbp pahu shaker logs va vn2", dyn: 0.7 },
      { s: "B", play: "mel:fl mel:mar~-2 strum harp vcp cbp pahu shaker logs va vn2", dyn: 0.72, rit: 0.92 },
    ],
    [
      { s: "A", play: "mel:mar strum shaker", dyn: 0.6 },
      { s: "A", play: "mel:fl mel:mar~-2 strum vcp cbp pahu shaker va", dyn: 0.66 },
      { s: "B", play: "mel:fl strum harp vcp cbp pahu shaker logs va vn2", dyn: 0.7 },
      { s: "B", play: "mel:mar mel:fl strum harp vcp cbp pahu shaker va vn2", dyn: 0.7, rit: 0.92 },
    ],
  ],
  rest: [10, 18],
};
