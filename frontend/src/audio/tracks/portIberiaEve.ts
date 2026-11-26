// 《贝伦的晚钟》：伊比利亚人的港口（里斯本、塞维利亚、加的斯，以及他们在大西洋群岛、非洲、印度与新大陆的那些港口）的第二首——
// 傍晚，修道院敲了晚祷的钟，码头上的人散了，有人在窗下拨琴。与《橙花码头》轮着放；天黑以后进港时先放这一首。
// 第九批 A01（2026-11-11）新写，旋律原创。E 小调，3/4 拍（每分钟 88 拍），慢、带一点思念（葡萄牙人后来叫它 saudade）：
// - 引子：远处的钟两下，维韦拉琴的分解和弦；
// - A：维奥尔琴唱主题（一句往上、一句落下，B 大三和弦的升 D 把它引回主音）；A′：中音竖笛在高八度唱答句，便携管风琴在下面跟着；
// - B：转到 G 大调一侧，短号吹一段更亮的句子（河口的晚霞），停在属和弦上；
// - 尾声钟再敲一下。阿杜菲方鼓只轻轻地点着拍子。
// 弦乐群与拨奏低音只做极轻的衬底，钟在管弦版里是管钟。
import type { TrackDef } from "../score";

export const PORT_IBERIA_EVE: TrackDef = {
  id: "port_iberia_eve",
  title: { zh: "贝伦的晚钟" },
  qpm: 88,
  meter: [3, 4],
  key: "E minor",
  level: 1.23,
  space: 1.1,
  voices: {
    gamba: { inst: "gamba", gain: 0.56, pan: -0.12, reverb: 0.34 },
    reca: { inst: "rec_alto", gain: 0.46, pan: 0.12, reverb: 0.36 },
    org: { inst: "organetto", gain: 0.34, pan: 0.2, reverb: 0.34 },
    cornett: { inst: "cornett", gain: 0.5, pan: -0.18, reverb: 0.36 },
    varp: { inst: "vihuela", gain: 0.34, pan: 0.3, reverb: 0.28, pattern: { kind: "arp", low: 40, steps: "1 5 8 10 8 5", ring: 2 } },
    adufe: { inst: "perc", gain: 0.24, pan: 0.08, reverb: 0.26, pattern: { kind: "drum", steps: "A.t.t.", hits: { A: ["adufe", 0.46], t: ["adufe_tek", 0.24] } } },
    // 衬底（合成）
    bell: { inst: "bell", gain: 0.24, pan: 0.32, reverb: 0.56 },
    pad: { inst: "strings", gain: 0.15, pan: -0.2, reverb: 0.44, pattern: { kind: "pad", low: 55, high: 72, size: 3 } },
    pz: { inst: "pizz", gain: 0.18, pan: 0.05, reverb: 0.16, pattern: { kind: "arp", low: 40, steps: "1 . . . 5 .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "Em | Em | Am | B",
      lines: { bell: "E6 | z6 | z6 | B,6" },
    },
    A: {
      bars: 8,
      chords: "Em | Am | D | G | C | Am | B | Em",
      lines: {
        mel: "E2 G2 B2 | c3 B A2 | A2 d2 f2 | g d B2 d2 | e3 d c2 | A2 c2 e2 | ^d3 e f2 | e6",
      },
    },
    A2: {
      bars: 8,
      chords: "Em | B | C | G | Am | Em | B | Em",
      lines: {
        mel2: "e2 g2 b2 | b3 a f2 | g2 e2 c'2 | b3 a g2 | a2 e2 c2 | B2 e2 g2 | f3 e ^d2 | e6",
      },
    },
    B: {
      bars: 8,
      chords: "G | D | Em | B | C | G | Am | B",
      lines: {
        bmel: "d4 B2 | f3 e d2 | e4 B2 | B2 ^d2 f2 | g4 e2 | d3 c B2 | c2 e2 a2 | f6",
      },
    },
    outro: {
      bars: 4,
      chords: "C | B | Em | Em",
      lines: {
        tag: "e3 d c2 | ^d3 e f2 | e6 | z6",
        bell: "z6 | z6 | z6 | E6",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "bell:bell varp", dyn: 0.5, to: 0.56 },
      { s: "A", play: "mel:gamba varp pz", dyn: 0.6 },
      { s: "A2", play: "mel2:reca mel2:org-12 varp pad pz adufe", dyn: 0.62 },
      { s: "B", play: "bmel:cornett varp pad pz adufe", dyn: 0.62, to: 0.66 },
      { s: "A2", play: "mel2:reca mel2:gamba-12 varp pad pz adufe", dyn: 0.66, to: 0.6 },
      { s: "outro", play: "tag:gamba bell:bell varp pad", dyn: 0.56, to: 0.4, rit: 0.82 },
    ],
    [
      { s: "intro", play: "bell:bell varp", dyn: 0.5, to: 0.54 },
      { s: "A", play: "mel:cornett varp pz", dyn: 0.58 },
      { s: "B", play: "bmel:gamba varp pad pz adufe", dyn: 0.6 },
      { s: "A", play: "mel:gamba mel:org varp pad pz adufe", dyn: 0.62 },
      { s: "A2", play: "mel2:reca mel2:gamba-12 varp pad pz adufe", dyn: 0.66, to: 0.6 },
      { s: "outro", play: "tag:gamba bell:bell varp pad", dyn: 0.56, to: 0.4, rit: 0.82 },
    ],
  ],
  rest: [10, 18],
};
