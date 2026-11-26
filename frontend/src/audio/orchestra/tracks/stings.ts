// 时间线事件的短乐句（管弦版）：编号、调与合成版一一对应（../../tracks/stings.ts），移调 −6…+5 之后每个音都在采样的音域里（测试逐音检查）。
// 凯旋：小号的上行琶音、低八度圆号、定音鼓滚奏后一击（定音鼓按乐队的调法写在 A2 与 D3 上）、竖琴刮奏、一记对击钹、弦乐和弦；
// 功败：第一小提琴的叹息、低处圆号与大提琴组、竖琴的小调分解和弦、定音鼓轻轻一下；史书照旧：圆号与小提琴的变格终止、竖琴、管钟；
// 沙漏：定音鼓的心跳、响棒越敲越密、圆号沿属七和弦往上爬、大提琴组的长音、高处小提琴组的颤弓和弦。
import type { TrackDef } from "../../score";
import { STINGS as SYNTH, type StingId } from "../../tracks/stings";
import { bass, chords, line, pulse, SEAT, WET } from "./kit";

const L = (id: StingId, l: string) => SYNTH[id].sections.A.lines![l];

const WIN: TrackDef = {
  ...SYNTH.history_win,
  level: 0.9,
  voices: {
    tp: line("o.tp", 0.5, SEAT.tp, WET.brass),
    hn: line("o.hn", 0.48, SEAT.hn, WET.brass),
    timp: line("o.timp", 0.46, SEAT.timp, 0.3),
    harp: line("o.harp", 0.3, SEAT.harp, WET.harp),
    perc: line("o.perc", 0.3, 0.3, 0.4),
    vn2: chords("o.vn", 0.15, SEAT.vn2, WET.strings, 66, 78, 2),
    va: chords("o.va", 0.15, SEAT.va, WET.strings, 57, 69, 3),
    vc: line("o.vc", 0.4, SEAT.vc, 0.26, bass("1 . . . . . . .", 43)),
  },
  sections: {
    A: {
      ...SYNTH.history_win.sections.A,
      lines: { tp: L("history_win", "tp"), hn: L("history_win", "hn"), timp: "z4 !trem!A,,4 | !accent!D,2 z6", gliss: L("history_win", "gliss"), crash: "z8 | =F8" },
    },
  },
  forms: [[{ s: "A", play: "tp:tp hn:hn timp:timp gliss:harp crash:perc vn2 va vc", dyn: 0.8, to: 0.72 }]],
};

const LOSS: TrackDef = {
  ...SYNTH.history_loss,
  level: 1.1,
  voices: {
    vn1: line("o.vn", 0.5, SEAT.vn1, 0.42),
    hn: line("o.hn", 0.44, SEAT.hn, 0.42),
    vc: line("o.vc", 0.48, SEAT.vc, 0.36),
    harp: line("o.harp", 0.3, SEAT.harp, 0.5),
    timp: line("o.timp", 0.34, SEAT.timp, 0.4),
    va: chords("o.va", 0.14, SEAT.va, 0.46, 57, 69, 3),
  },
  forms: [[{ s: "A", play: "vn:vn1 hn:hn vc:vc gliss:harp timp:timp va", dyn: 0.72, to: 0.6, rit: 0.85 }]],
};

const AS_IS: TrackDef = {
  ...SYNTH.history_as_is,
  level: 1.1,
  voices: {
    hn: line("o.hn", 0.46, SEAT.hn, 0.4),
    vn1: line("o.vn", 0.44, SEAT.vn1, 0.42),
    harp: line("o.harp", 0.3, SEAT.harp, 0.46),
    bell: line("o.tubular", 0.26, SEAT.bells, WET.bells),
    va: chords("o.va", 0.14, SEAT.va, 0.44, 57, 69, 3),
    vc: chords("o.vc", 0.14, SEAT.vc, 0.36, 43, 55, 1),
  },
  forms: [[{ s: "A", play: "hn:hn vn:vn1 gliss:harp bell:bell va vc", dyn: 0.7, to: 0.6, rit: 0.9 }]],
};

const DEADLINE: TrackDef = {
  ...SYNTH.deadline,
  voices: {
    hn: line("o.hn", 0.46, SEAT.hn, 0.34),
    trem: chords("o.vn.trem", 0.12, SEAT.vn2, 0.38, 67, 81, 3),
    vn1: line("o.vn.trem", 0.3, SEAT.vn1, 0.36),
    vc: line("o.vc", 0.32, SEAT.vc, 0.3),
    timp: line("o.timp", 0.46, SEAT.timp, 0.3),
    tick: pulse("o.perc", 0.3, 0.3, 0.2, { kind: "drum", steps: "c.c.c.c.cccccccc", hits: { c: ["claves", 0.4] } }),
  },
  forms: [[{ s: "A", play: "hn:hn vn:vn1 vc:vc timp:timp trem tick", dyn: 0.66, to: 0.8 }]],
};

export const ORCH_STINGS: Readonly<Record<StingId, TrackDef>> = {
  history_win: WIN,
  history_loss: LOSS,
  history_as_is: AS_IS,
  deadline: DEADLINE,
};
