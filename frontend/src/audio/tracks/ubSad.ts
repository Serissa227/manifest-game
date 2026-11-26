// 《落雨的庭院》：养成篇的事件 · 悲伤（离别、病中的老人、没能赶上的约定……）。D 小调，慢 3/4（每分钟 60 拍，一小节三秒），不煽情。
// 低音一级级往下走（D → C → 降 B → A，哀歌式的下行四音），提琴的旋律一开口就往上够了一个四度，随后一路叹气似的往下落；
// 竖琴高处偶尔一个单音，像屋檐滴下来的雨；B 段转到 F 大调一侧，是想起来的那些暖和的日子，最后仍回到 A 大三和弦上，等着下一句。
// 没有打击乐，弦乐很轻，留白长一点。
import type { TrackDef } from "../score";

export const UB_SAD: TrackDef = {
  id: "ub_sad",
  title: { zh: "落雨的庭院", en: "Rain in the Courtyard" },
  qpm: 60,
  meter: [3, 4],
  key: "D minor",
  level: 1.15,
  space: 1.15,
  voices: {
    fiddle: { inst: "fiddle", gain: 0.56, pan: -0.16, reverb: 0.42 },
    cello: { inst: "cello", gain: 0.52, pan: 0.22, reverb: 0.38 },
    flute: { inst: "flute", gain: 0.48, pan: 0.04, reverb: 0.42 },
    drop: { inst: "harp", gain: 0.3, pan: -0.36, reverb: 0.6 },
    harp: { inst: "harp", gain: 0.28, pan: -0.24, reverb: 0.46, pattern: { kind: "arp", low: 38, steps: "1 . 5 . 10 .", ring: 3 } },
    strings: { inst: "strings", gain: 0.32, pan: 0.16, reverb: 0.46, pattern: { kind: "pad", low: 55, high: 70, size: 3 } },
    low: { inst: "strings", gain: 0.36, pan: 0.06, reverb: 0.34, pattern: { kind: "pad", low: 33, high: 45, size: 1 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "Dm | Bb",
      lines: { drops: "z2 a'2 z2 | z4 f'2" },
    },
    A: {
      bars: 8,
      // 低音：D → C → 降 B → A，再 G → F → E → A
      chords: "Dm | Dm/C | Bb | A | Gm | Dm/F | Em7b5 | A7",
      lines: {
        mel: "A4 d2 | c3 B A2 | B4 A2 | E4 z2 | G3 A B2 | A4 F2 | G3 F E2 | ^c6",
        drops: "z2 a'2 z2 | z6 | z4 f'2 | z6 | z2 d'2 z2 | z6 | z4 e'2 | z6",
      },
    },
    B: {
      bars: 8,
      chords: "F | C/E | Dm | Am | Bb | F/A | Gm7 | A",
      lines: {
        bmel: "f4 c2 | e3 d c2 | d4 A2 | c4 z2 | d3 e f2 | c3 d e2 | d3 c B2 | A6",
        drops: "z4 c'2 | z6 | z2 a'2 z2 | z6 | z4 f'2 | z6 | z2 g'2 z2 | z6",
      },
    },
    outro: { bars: 2, chords: "Gm | Dm", lines: { tag: "B3 A G2 | D6", drops: "z6 | z2 a'2 z2" } },
  },
  forms: [
    [
      { s: "intro", play: "drops:drop strings low", dyn: 0.48 },
      { s: "A", play: "mel:fiddle drops:drop harp low", dyn: 0.56 },
      { s: "B", play: "bmel:cello-12 drops:drop harp strings low", dyn: 0.58 },
      { s: "A", play: "mel:fiddle mel:cello-12 harp strings low", dyn: 0.6, to: 0.54 },
      { s: "outro", play: "tag:fiddle drops:drop strings low", dyn: 0.48, to: 0.34, rit: 0.85 },
    ],
    [
      { s: "intro", play: "drops:drop low", dyn: 0.46 },
      { s: "A", play: "mel:cello-12 drops:drop harp low", dyn: 0.56 },
      { s: "B", play: "bmel:flute drops:drop harp strings low", dyn: 0.58 },
      { s: "A", play: "mel:fiddle harp strings low", dyn: 0.58, to: 0.52 },
      { s: "outro", play: "tag:cello-12 drops:drop strings low", dyn: 0.46, to: 0.32, rit: 0.85 },
    ],
  ],
  rest: [10, 16],
};
