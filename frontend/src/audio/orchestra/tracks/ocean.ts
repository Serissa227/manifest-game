// 《晨星洋》管弦版（远洋，D 大调，慢 4/4，一小节四秒）：旋律与和声同合成版，按管弦乐重新配器。
// 第一小提琴拉那条很长的旋律（六度大跳之后慢慢落下，像一道涌浪）；每句末尾圆号在远处（声像偏左、混响多）用起帆动机呼应；
// 竖琴一上一下的琶音是海面的起伏，大提琴组与低音提琴在最低处守着 D 与 A 的空五度，中提琴与大提琴的和弦长音托着，
// 高处的小提琴分部像天光。定音鼓只在句尾轻轻滚奏。
// B 段转到 B 小调：大提琴组在它最高、最有张力的音区唱（第二遍换单簧管），小提琴在上面拉长音，竖琴与钟琴点几颗星；
// 全奏的 A2 第一小提琴、低八度的大提琴组与圆号齐奏主题；尾声小提琴 升 F → G → 升 G → A 慢慢爬上去，停在主和弦的五音上。
import type { TrackDef } from "../../score";
import { OCEAN as SYNTH } from "../../tracks/ocean";
import { bass, chords, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const OCEAN: TrackDef = {
  id: "ocean",
  title: SYNTH.title,
  qpm: 60,
  meter: [4, 4],
  key: "D major",
  hall: true,
  level: 0.95,
  voices: {
    vn1: line("o.vn", 0.56, SEAT.vn1, 0.38),
    vcm: line("o.vc", 0.58, SEAT.vc, 0.34),
    cl: line("o.cl", 0.5, SEAT.cl, WET.winds),
    hn: line("o.hn", 0.4, -0.4, 0.56),
    vhi: chords("o.vn", 0.13, SEAT.vn2, 0.46, 74, 86, 3),
    va: chords("o.va", 0.11, SEAT.va, 0.4, 55, 69, 3),
    vc: line("o.vc", 0.34, SEAT.vc, 0.24, bass("B . . . . . . .", 38)),
    // 最低处 D 与 A 的空五度（大提琴组与低音提琴）
    drone: { inst: "o.vc", gain: 0.2, pan: SEAT.vc, reverb: 0.3, poly: true, pattern: { kind: "drone", notes: [38, 45] } },
    cb: line("o.cb", 0.26, SEAT.cb, 0.22, { a: bass("B . . . . . . .", 26), d: { kind: "drone", notes: [26] } }),
    harp: pulse("o.harp", 0.3, SEAT.harp, WET.harp, {
      a: { kind: "arp", low: 43, steps: "1 5 8 10 12 10 8 5", ring: 2 },
      b: { kind: "arp", low: 43, steps: "1 5 8 12 15 12 8 5", ring: 2 },
    }),
    stars: line("o.harp", 0.26, SEAT.harp + 0.1, 0.5),
    glock: line("o.glock", 0.14, SEAT.glock, 0.6),
    timp: line("o.timp", 0.36, SEAT.timp, 0.36),
  },
  sections: {
    intro: { ...S.intro },
    A1: { ...S.A1 },
    A2: { ...S.A2 },
    B: { ...S.B },
    outro: { ...S.outro },
  },
  forms: [
    [
      { s: "intro", play: "drone cb.d timp:timp echo:hn harp va", dyn: 0.4, to: 0.58 },
      { s: "A1", play: "mel:vn1 echo:hn harp vc cb va", dyn: 0.6 },
      { s: "A2", play: "mel:vn1 echo:hn timp:timp harp vc cb va vhi", dyn: 0.64, to: 0.72 },
      { s: "B", play: "mel:vcm desc:vn1 stars:stars stars:glock+12 harp.b vhi cb", dyn: 0.62, to: 0.7 },
      { s: "A2", play: "mel:vn1 mel:vcm-12 mel:hn-12 timp:timp harp vc cb va vhi", dyn: 0.76 },
      { s: "outro", play: "tag:vn1 echo:hn harp drone cb.d va", dyn: 0.58, to: 0.36, rit: 0.85 },
    ],
    [
      { s: "intro", play: "drone cb.d harp va", dyn: 0.38, to: 0.55 },
      { s: "A1", play: "mel:vcm-12 harp vc va", dyn: 0.58 },
      { s: "A2", play: "mel:vn1 echo:hn harp vc cb va", dyn: 0.62, to: 0.68 },
      { s: "B", play: "mel:cl stars:stars stars:glock+12 harp.b vhi cb", dyn: 0.6, to: 0.68 },
      { s: "A2", play: "mel:vn1 mel:vcm-12 mel:hn-12 timp:timp harp vc cb va vhi", dyn: 0.74 },
      { s: "outro", play: "tag:vn1 harp.b drone cb.d va", dyn: 0.56, to: 0.34, rit: 0.85 },
    ],
  ],
  rest: [30, 50],
};
