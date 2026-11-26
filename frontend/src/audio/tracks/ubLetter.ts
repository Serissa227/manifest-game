// 《远方的来信》：养成篇的远方来信（其他主角与远方的朋友写来的信，随船期迟到几个月）。E 小调，6/8 的船歌（每分钟 72 拍），怀念。
// 信是坐船来的：竖琴一上一下的分解和弦像海面的起伏，开头远处的圆号吹起全作的起帆动机（B → E → B，移到 E 小调上）；
// A 段木笛唱主题，开头一个六度的上跳（B → G，想念一个人时那一下“够”），句尾经过 B 七和弦（升 D）落回 E；
// B 段转到 G 大调一侧，是信里写的那些事、一起度过的那些日子，明亮一点；尾声停在 E 大三和弦上（皮卡第三度：读完了，心里是暖的）。
import type { TrackDef } from "../score";

export const UB_LETTER: TrackDef = {
  id: "ub_letter",
  title: { zh: "远方的来信", en: "A Letter from Afar" },
  qpm: 72,
  meter: [6, 8],
  key: "E minor",
  level: 1.08,
  voices: {
    flute: { inst: "flute", gain: 0.58, pan: -0.1, reverb: 0.38 },
    fiddle: { inst: "fiddle", gain: 0.54, pan: 0.16, reverb: 0.38 },
    cello: { inst: "cello", gain: 0.46, pan: 0.24, reverb: 0.34 },
    horns: { inst: "horns", gain: 0.4, pan: -0.36, reverb: 0.55 },
    harp: {
      inst: "harp",
      gain: 0.34,
      pan: -0.26,
      reverb: 0.4,
      pattern: {
        a: { kind: "arp", low: 40, steps: "1 5 8 10 8 5", ring: 2 },
        b: { kind: "arp", low: 40, steps: "1 . 8 . 10 .", ring: 3 },
      },
    },
    strings: { inst: "strings", gain: 0.32, pan: 0.18, reverb: 0.44, pattern: { kind: "pad", low: 55, high: 71, size: 3 } },
    low: { inst: "strings", gain: 0.34, pan: 0.06, reverb: 0.32, pattern: { kind: "pad", low: 36, high: 48, size: 1 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "Em | Cmaj7",
      // 远处的圆号：起帆动机移到 E 小调上
      lines: { call: "z4 B,3/2 E/2 | B6" },
    },
    A: {
      bars: 8,
      chords: "Em | Am | D | G | C | Am | B7 | Em",
      lines: {
        mel: "B,3 G2 F | E3 A2 G | F3 D2 E | D6 | E3 c2 B | A3 E2 F | ^D3 F2 A | E6",
      },
    },
    B: {
      bars: 8,
      chords: "G | D/F# | Em | C | G/B | Am7 | D | D7",
      lines: {
        bmel: "d3 B2 G | A3 F2 D | G3 B2 e | e3 d2 c | d3 g2 f | e3 c2 A | F3 A2 d | A3 c3",
      },
    },
    outro: {
      bars: 2,
      chords: "Am6 | E",
      lines: { tag: "A3 E2 C | ^G6", call: "z4 B,3/2 E/2 | B6" },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:horns harp low", dyn: 0.5, to: 0.56 },
      { s: "A", play: "mel:flute harp low", dyn: 0.58 },
      { s: "B", play: "bmel:fiddle harp strings low", dyn: 0.6, to: 0.64 },
      { s: "A", play: "mel:fiddle mel:cello-12 harp strings low", dyn: 0.62 },
      { s: "outro", play: "tag:flute call:horns harp.b strings low", dyn: 0.52, to: 0.36, rit: 0.85 },
    ],
    [
      { s: "intro", play: "call:horns harp.b", dyn: 0.48, to: 0.54 },
      { s: "A", play: "mel:cello harp low", dyn: 0.56 },
      { s: "B", play: "bmel:flute harp strings low", dyn: 0.6, to: 0.64 },
      { s: "A", play: "mel:flute mel:cello-12 harp strings low", dyn: 0.62 },
      { s: "outro", play: "tag:fiddle call:horns harp.b strings low", dyn: 0.5, to: 0.34, rit: 0.85 },
    ],
  ],
  rest: [10, 16],
};
