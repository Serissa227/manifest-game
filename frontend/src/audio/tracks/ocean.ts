// 《晨星洋》：穿过巨人之门后的外洋，远离一切海岸的大洋。D 大调，慢 4/4（一小节四秒），开阔、辽远。
// 小提琴组拉一条很长的旋律（六度大跳之后慢慢往下落，像一道涌浪），每句末尾圆号在远处用主题曲的起帆动机呼应一声
// （落在 B 小调、A、E 大三和弦与 D 上，E 大三和弦里的升 G 是利底亚式的“远方”色彩）；
// 竖琴一上一下的琶音是海面的起伏，大提琴与低音长音、定音鼓轻轻滚奏托在最下面。
// B 段转到 B 小调，圆号接过旋律，小提琴在上面拉长音，钢片琴点几颗星；全奏时圆号低八度与小提琴齐奏主题。
// 尾声小提琴 升 F → G → 升 G → A 慢慢爬上去，停在主和弦的五音上，像海平线没有尽头。
import type { TrackDef } from "../score";

export const OCEAN: TrackDef = {
  id: "ocean",
  title: { zh: "晨星洋", en: "The Morningstar Ocean" },
  qpm: 60,
  meter: [4, 4],
  key: "D major",
  hall: true,
  voices: {
    violins: { inst: "violins", gain: 0.58, pan: 0.18, reverb: 0.4 },
    horns: { inst: "horns", gain: 0.5, pan: -0.32, reverb: 0.55 },
    celli: { inst: "celli", gain: 0.44, pan: 0.12, reverb: 0.32, pattern: { kind: "arp", low: 38, steps: "b . . . . . . ." } },
    harp: {
      inst: "harp",
      gain: 0.3,
      pan: -0.35,
      reverb: 0.42,
      pattern: {
        a: { kind: "arp", low: 43, steps: "1 5 8 10 12 10 8 5", ring: 2 },
        b: { kind: "arp", low: 43, steps: "1 5 8 12 15 12 8 5", ring: 2 },
      },
    },
    strings: { inst: "strings", gain: 0.42, pan: 0.25, reverb: 0.5, pattern: { kind: "pad", low: 55, high: 74, size: 3 } },
    choir: { inst: "choir", gain: 0.38, pan: -0.1, reverb: 0.6, pattern: { kind: "pad", low: 62, high: 79, size: 3 } },
    drone: { inst: "drone", gain: 0.45, reverb: 0.3, pattern: { kind: "drone", notes: [38, 45] } },
    celesta: { inst: "celesta", gain: 0.34, pan: 0.4, reverb: 0.6 },
    timp: { inst: "timpani", gain: 0.44, reverb: 0.4 },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "D | E/D | D | A",
      lines: {
        timp: "!trem!D,,8- | D,,8 | z8 | z8",
        echo: "z8 | z8 | A,3/2 D/2 A6 | z8",
      },
    },
    A1: {
      bars: 8,
      chords: "D | A/C# | Bm | G | D/F# | E | G | A",
      lines: {
        mel: "A4 f4 | e6 c2 | d8 | B4 G4 | A4 d4 | ^g6 e2 | d4 c2 B2 | A8",
        // 远处的圆号：每句末尾吹一声起帆动机
        echo: "z8 | z8 | z4 F,3/2 B,/2 F2 | z8 | z8 | z8 | z8 | z4 E,3/2 A,/2 E2",
      },
    },
    A2: {
      bars: 8,
      chords: "D | A/C# | Bm | E | G | D/F# | Em7 A | D",
      lines: {
        mel: "A4 f4 | e6 c2 | d4 f4 | ^g8 | a6 g2 | f4 e2 d2 | e4 c4 | d8",
        echo: "z8 | z8 | z8 | z4 B,3/2 E/2 B2 | z8 | z8 | z8 | z4 A,3/2 D/2 A2",
        timp: "!trem!D,,8 | z8 | z8 | !trem!E,,8 | z8 | z8 | z4 !trem!A,,4 | !accent!D,,2 z6",
      },
    },
    B: {
      bars: 8,
      chords: "Bm | G | D | A | Bm | G | Em | A",
      lines: {
        mel: "F4 B4 | B4 A2 G2 | A4 F4 | E8 | F4 d4 | d4 c2 B2 | B4 G4 | A8",
        // 小提琴在上面拉的长音
        desc: "f8 | d8 | d8 | c8 | f8 | d8 | e8 | e8",
        // 钢片琴：每小节后半的两个高音，像海面上的星光
        stars: `z4 f'2 d'2 | z4 d'2 b2 | z4 a2 f2 | z4 e'2 c'2 |
                z4 b'2 f'2 | z4 g'2 d'2 | z4 e'2 b2 | z4 c'2 a2`,
      },
    },
    outro: {
      bars: 4,
      chords: "D | G/D | E/D | D",
      lines: {
        tag: "f8 | g8 | ^g8 | a8",
        echo: "z4 A,3/2 D/2 A2 | z8 | z8 | z8",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "drone timp:timp echo:horns harp strings", dyn: 0.4, to: 0.58 },
      { s: "A1", play: "mel:violins echo:horns harp celli strings", dyn: 0.6 },
      { s: "A2", play: "mel:violins echo:horns harp celli strings choir", dyn: 0.66, to: 0.72 },
      { s: "B", play: "mel:horns desc:violins stars:celesta harp.b choir celli", dyn: 0.64, to: 0.72 },
      { s: "A2", play: "mel:violins mel:horns-12 timp:timp harp celli strings choir", dyn: 0.78 },
      { s: "outro", play: "tag:violins echo:horns harp drone strings", dyn: 0.6, to: 0.36, rit: 0.85 },
    ],
    [
      { s: "intro", play: "drone harp strings", dyn: 0.38, to: 0.55 },
      { s: "A1", play: "mel:horns-12 harp celli strings", dyn: 0.58 },
      { s: "A2", play: "mel:violins echo:horns harp celli strings", dyn: 0.64, to: 0.7 },
      { s: "B", play: "mel:violins stars:celesta harp.b choir celli", dyn: 0.62, to: 0.7 },
      { s: "A2", play: "mel:violins mel:horns-12 timp:timp harp celli strings choir", dyn: 0.76 },
      { s: "outro", play: "tag:violins harp.b drone strings", dyn: 0.58, to: 0.34, rit: 0.85 },
    ],
  ],
  rest: [30, 50],
};
