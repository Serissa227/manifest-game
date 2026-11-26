// 《瑶华季风》管弦版（东方海域，D 宫五声，6/8，像季风推着帆）：旋律与和声同合成版，按管弦乐重新配器。
// 笛子的旋律交给长笛（高音区明亮，保留倚音与上滑音）；古筝的旋律改成竖琴与小提琴组拨奏同奏，古筝的分解和弦是竖琴；
// 笙托着的长音改成中提琴与第二小提琴很轻的和弦长音；低音提琴拨奏落在第一、四拍；
// 锣是乐队的大锣，梆子与木鱼改成响棒与高木鼓“嗒 · · 笃 · ·”。开头竖琴一串五声音阶的上行刮奏、一声锣，长笛吹起帆动机。
import type { TrackDef } from "../../score";
import { SEA_EAST as SYNTH } from "../../tracks/seaEast";
import { bass, chords, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const SEA_EAST: TrackDef = {
  id: "sea_east",
  title: SYNTH.title,
  qpm: 96,
  meter: [6, 8],
  key: "D major",
  voices: {
    fl: line("o.fl", 0.56, SEAT.fl, 0.4),
    ob: line("o.ob", 0.46, SEAT.ob, 0.36),
    cl: line("o.cl", 0.44, SEAT.cl, 0.36),
    hp: line("o.harp", 0.4, SEAT.harp, 0.36),
    pz: line("o.vn.pizz", 0.36, SEAT.vn1, 0.3),
    arp: pulse("o.harp", 0.24, SEAT.harp + 0.1, WET.harp, { kind: "arp", low: 50, steps: "1 5 8 10 12 10", ring: 3 }),
    vn2: chords("o.vn", 0.12, SEAT.vn2, 0.4, 66, 79, 3),
    va: chords("o.va", 0.11, SEAT.va, 0.4, 57, 69, 2),
    cbp: pulse("o.cb.pizz", 0.34, SEAT.cb, WET.low, bass("1 . . 5 . .", 26, 2)),
    vcp: pulse("o.vc.pizz", 0.32, SEAT.vc, WET.low, bass("1 . . 5 . .", 38, 2)),
    gong: line("o.perc", 0.34, 0.08, 0.6),
    wood: pulse("o.perc", 0.3, -0.2, 0.3, { kind: "drum", steps: "c..w..", hits: { c: ["claves", 0.36], w: ["loghi", 0.3] } }),
  },
  sections: {
    intro: {
      ...S.intro,
      lines: {
        gliss: S.intro.lines!.gliss,
        motif: S.intro.lines!.motif,
        // 大锣（打击乐声部的旋律行：g 是大锣）
        gong: "g6 | z6 | z6 | z6",
      },
    },
    A: { ...S.A },
    B: { ...S.B, lines: { mel: S.B.lines!.mel, gong: "g6 | z6 | z6 | z6 | z6 | z6 | z6 | z6" } },
    outro: { ...S.outro, lines: { tag: S.outro.lines!.tag, gong: "z6 | z6 | g6 | z6" } },
  },
  forms: [
    [
      { s: "intro", play: "gliss:hp gong:gong motif:fl arp va", dyn: 0.56, to: 0.62 },
      { s: "A", play: "mel:fl arp cbp vcp wood", dyn: 0.62 },
      { s: "A", play: "mel2:fl mel:pz-12 arp va vn2 cbp vcp wood", dyn: 0.66 },
      { s: "B", play: "mel:hp mel:pz gong:gong arp va vn2 cbp vcp wood", dyn: 0.64 },
      { s: "B", play: "mel:fl mel:cl-12 arp va vn2 cbp vcp wood", dyn: 0.68 },
      { s: "A", play: "mel2:fl arp va vn2 cbp vcp wood", dyn: 0.7 },
      { s: "outro", play: "tag:fl gong:gong arp va", dyn: 0.58, to: 0.38, rit: 0.85 },
    ],
    [
      { s: "intro", play: "gliss:hp gong:gong arp", dyn: 0.54, to: 0.6 },
      { s: "A", play: "mel:hp-12 mel:pz-12 arp cbp", dyn: 0.6 },
      { s: "A", play: "mel:fl arp va vn2 cbp vcp wood", dyn: 0.64 },
      { s: "B", play: "mel:fl gong:gong arp va vn2 cbp vcp wood", dyn: 0.66 },
      { s: "B", play: "mel:ob arp va vn2 cbp vcp wood", dyn: 0.66 },
      { s: "A", play: "mel2:fl mel:pz-12 arp va vn2 cbp vcp wood", dyn: 0.7 },
      { s: "outro", play: "tag:fl gong:gong arp va", dyn: 0.56, to: 0.36, rit: 0.85 },
    ],
  ],
  rest: [25, 45],
};
