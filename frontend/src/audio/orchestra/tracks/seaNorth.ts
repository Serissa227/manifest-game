// 《北风与白鲸》管弦版（北方寒冷的海域，D 多利亚，6/8，浪大而沉）：旋律与和声同合成版，按管弦乐重新配器。
// 最低处大提琴组与低音提琴守着 D 与 A 的空五度（像冰原上的风），高处小提琴组极轻的颤弓拉着空五度，冷得发亮；
// 竖琴代替卡恩特勒琴弹分解和弦，定音鼓在第一、四拍轻轻地敲（像心跳，也像浪拍船身）。
// 开头圆号在低处远远吹起帆动机；A 段小提琴组唱那条带多利亚还原 B 的宽旋律，重复时交给双簧管（带倚音与回旋音），钟琴点冰晶；
// B 段大提琴组唱号角式的旋律、圆号低八度同奏，小提琴在高处拉长音，中提琴的和弦长音像北风。
import type { TrackDef } from "../../score";
import { SEA_NORTH as SYNTH } from "../../tracks/seaNorth";
import { chords, held, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const SEA_NORTH: TrackDef = {
  id: "sea_north",
  title: SYNTH.title,
  qpm: 84,
  meter: [6, 8],
  key: "D dorian",
  hall: true,
  level: 1.1,
  voices: {
    vn1: line("o.vn", 0.54, SEAT.vn1, 0.36),
    ob: line("o.ob", 0.52, SEAT.ob, 0.38),
    vcm: line("o.vc", 0.56, SEAT.vc, 0.32),
    hn: line("o.hn", 0.44, SEAT.hn, 0.46),
    va: chords("o.va", 0.11, SEAT.va, 0.42, 55, 69, 3),
    // 高处极轻的颤弓：A 与 E 的空五度
    ice5: { ...held("o.vn.trem", 0.1, SEAT.vn2, 0.5), pattern: { kind: "drone", notes: [69, 76] } },
    // 最低处 D 与 A 的空五度
    drone: { inst: "o.vc", gain: 0.2, pan: SEAT.vc, reverb: 0.3, poly: true, pattern: { kind: "drone", notes: [38, 45] } },
    cb: { inst: "o.cb", gain: 0.2, pan: SEAT.cb, reverb: 0.24, poly: true, pattern: { kind: "drone", notes: [26] } },
    harp: pulse("o.harp", 0.3, SEAT.harp, WET.harp, { kind: "arp", low: 50, steps: "1 5 8 10 8 5", ring: 2 }),
    glock: line("o.glock", 0.16, SEAT.glock, 0.6),
    timp: pulse("o.timp", 0.3, SEAT.timp, 0.34, { kind: "arp", low: 38, steps: "1 - - 5 - -" }),
  },
  sections: {
    intro: { ...S.intro },
    A: { ...S.A },
    B: { ...S.B },
    outro: { ...S.outro },
  },
  forms: [
    [
      { s: "intro", play: "motif:hn-12 drone cb ice5 va", dyn: 0.46, to: 0.6 },
      { s: "A", play: "mel:vn1 harp drone cb timp", dyn: 0.62 },
      { s: "A", play: "mel2:ob ice:glock harp va drone timp", dyn: 0.64 },
      { s: "B", play: "hmel:vcm hmel:hn-12 desc:vn1 harp va timp", dyn: 0.64, to: 0.72 },
      { s: "A", play: "mel2:vn1 mel:vcm-12 ice:glock harp va drone cb timp", dyn: 0.72 },
      { s: "outro", play: "tag:vn1 harp drone cb ice5", dyn: 0.56, to: 0.36, rit: 0.8 },
    ],
    [
      { s: "intro", play: "motif:hn-12 drone cb harp", dyn: 0.44, to: 0.56 },
      { s: "A", play: "mel:vcm-12 harp drone cb", dyn: 0.6 },
      { s: "A", play: "mel:vn1 ice:glock harp va timp", dyn: 0.64 },
      { s: "B", play: "hmel:ob desc:vn1 harp va timp", dyn: 0.62, to: 0.7 },
      { s: "A", play: "mel2:vn1 mel:vcm-12 ice:glock harp va drone cb timp", dyn: 0.72 },
      { s: "outro", play: "tag:ob harp drone cb ice5", dyn: 0.54, to: 0.34, rit: 0.8 },
    ],
  ],
  rest: [25, 45],
};
