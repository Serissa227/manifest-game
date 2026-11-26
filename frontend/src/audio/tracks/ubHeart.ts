// 《指尖的余温》：养成篇的心动（学院期的朦胧、节日里并肩走过的一段路）。降 B 大调，慢 4/4（每分钟 66 拍），温柔、克制，不甜腻。
// 两个声部像两个人：提琴唱一句（开头一个六度的上跳，想说又停住），大提琴在它停下来的地方才开口，两条线总是错开，不同时说话；
// 和声多用七和弦与挂留（降 E 大七、F 挂四），A 段停在 F 挂四上——话没有说出口；
// B 段经过降 E 小三和弦（借来的小调四级，那一点点心酸），到最后一小节挂留音才落到三音上（F 挂四 → F 七），像终于松了一口气。
// 竖琴的分解和弦与很轻的弦乐托着；没有打击乐，也没有钢片琴的“叮叮”（不往甜里写）。
import type { TrackDef } from "../score";

export const UB_HEART: TrackDef = {
  id: "ub_heart",
  title: { zh: "指尖的余温", en: "Warmth on the Fingertips" },
  qpm: 66,
  meter: [4, 4],
  key: "Bb major",
  voices: {
    fiddle: { inst: "fiddle", gain: 0.56, pan: -0.16, reverb: 0.38 },
    cello: { inst: "cello", gain: 0.5, pan: 0.22, reverb: 0.34 },
    flute: { inst: "flute", gain: 0.5, pan: 0.04, reverb: 0.38 },
    harp: {
      inst: "harp",
      gain: 0.32,
      pan: -0.3,
      reverb: 0.42,
      pattern: {
        a: { kind: "arp", low: 46, steps: "1 5 8 10 12 10 8 5", ring: 2 },
        b: { kind: "arp", low: 46, steps: "1 . 8 . 10 . 12 .", ring: 3 },
      },
    },
    strings: { inst: "strings", gain: 0.3, pan: 0.16, reverb: 0.44, pattern: { kind: "pad", low: 57, high: 72, size: 3 } },
    low: { inst: "strings", gain: 0.34, pan: 0.06, reverb: 0.3, pattern: { kind: "pad", low: 34, high: 46, size: 1 } },
  },
  sections: {
    intro: { bars: 2, chords: "Bb | Ebmaj7/Bb" },
    A: {
      bars: 8,
      chords: "Bb | Dm7 | Ebmaj7 | Bb/D | Gm7 | Cm7 | Ebmaj7 | F7sus4",
      lines: {
        // 提琴：一个六度的上跳，停在 F 挂四上
        vmel: "F4 d3 c | c4 A2 F2 | G4 B2 d2 | c6 B2 | d4 g3 f | e4 d2 c2 | B4 G2 B2 | c8",
        // 大提琴：只在提琴停下来的地方开口
        cmel: "z4 B,2 D2 | F4 z2 A,2 | B,4 E2 G2 | F6 z2 | z4 B,2 D2 | G4 z2 C2 | E4 D2 C2 | B,8",
      },
    },
    B: {
      bars: 8,
      chords: "Gm | Ebmaj7 | Bb | F/A | Gm | Ebm | Bb/F | F7sus4 F7",
      lines: {
        // 降 E 小三和弦上的降 G 是那一点心酸；最后挂留音落到三音上
        bmel: "d4 B2 G2 | B4 G2 E2 | F4 B2 d2 | c6 z2 | d4 g2 f2 | _g4 f2 e2 | d4 c2 B2 | c4 A4",
        bcnt: "B,8 | G,8 | F,4 B,4 | A,4 C4 | B,4 D4 | _G,4 B,4 | F,4 D4 | E8",
      },
    },
    outro: { bars: 2, chords: "Ebmaj7 | Bb", lines: { tag: "G4 F4 | D8" } },
  },
  forms: [
    [
      { s: "intro", play: "harp.b low", dyn: 0.5 },
      { s: "A", play: "vmel:fiddle harp low", dyn: 0.56 },
      { s: "A", play: "vmel:fiddle cmel:cello harp strings low", dyn: 0.6 },
      { s: "B", play: "bmel:fiddle bcnt:cello harp.b strings low", dyn: 0.62, to: 0.66 },
      { s: "outro", play: "tag:fiddle harp.b strings low", dyn: 0.52, to: 0.36, rit: 0.85 },
    ],
    [
      { s: "intro", play: "harp.b", dyn: 0.48 },
      { s: "A", play: "vmel:cello-12 harp low", dyn: 0.56 },
      { s: "B", play: "bmel:flute bcnt:cello harp.b strings low", dyn: 0.6, to: 0.64 },
      { s: "A", play: "vmel:fiddle cmel:cello harp strings low", dyn: 0.6, to: 0.54 },
      { s: "outro", play: "tag:flute harp.b strings low", dyn: 0.5, to: 0.34, rit: 0.85 },
    ],
  ],
  rest: [8, 14],
};
