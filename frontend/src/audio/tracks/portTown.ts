// 《市政厅的号手》：北方与中欧的城镇（但泽、里加、纳尔瓦、戈尔韦，以及内陆的奥格斯堡、纽伦堡、维也纳、布拉格、克拉科夫……）的第二首——
// 每个自治城市都养着几名“城市号手”（Stadtpfeifer），整点在市政厅的塔楼上吹一段，集市与婚礼上也是他们。
// 与《峡湾炉火》轮着放（只在势力写了风格名的世界里）。第九批 A01（2026-11-11）新写，旋律原创。
// F 大调，4/4 拍（每分钟 104 拍）：
// - 引子：市政厅的排钟敲一串下行的音；
// - A：短号吹一段端正的“进场曲”（intrada），萨克布走低音，簧管风琴托着；
// - A′：两支克鲁姆管隔着三度吹答句（转到 D 小调一侧，嗡嗡的、带鼻音）；
// - B：换成跳的——肖姆管吹附点的舞曲（前短后长的小跳步），雇佣兵的长鼓敲着；
// - 最后一遍 A′ 短号与克鲁姆管一起；尾声排钟再敲一遍。
// 弦乐群与拨奏低音只做极轻的衬底（管弦版换成真的弦乐）。
import type { TrackDef } from "../score";

export const PORT_TOWN: TrackDef = {
  id: "port_town",
  title: { zh: "市政厅的号手" },
  qpm: 104,
  meter: [4, 4],
  key: "F major",
  level: 1.38,
  voices: {
    corn: { inst: "cornett", gain: 0.54, pan: -0.14, reverb: 0.36 },
    crum: { inst: "crumhorn", gain: 0.44, pan: 0.1, reverb: 0.3 },
    crum2: { inst: "crumhorn", gain: 0.36, pan: 0.2, reverb: 0.3 },
    shawm: { inst: "shawm", gain: 0.52, pan: -0.06, reverb: 0.32 },
    sack: { inst: "sackbut", gain: 0.42, pan: -0.28, reverb: 0.36, pattern: { kind: "arp", low: 41, steps: "1 . . . 5 . . .", ring: 3 } },
    regal: { inst: "regal", gain: 0.16, pan: 0.26, reverb: 0.38, pattern: { kind: "pad", low: 53, high: 69, size: 3 } },
    bells: { inst: "beiaard", gain: 0.3, pan: 0.32, reverb: 0.5 },
    trom: {
      inst: "perc",
      gain: 0.3,
      pan: 0.06,
      reverb: 0.26,
      pattern: {
        a: { kind: "drum", steps: "T..tT.t.", hits: { T: ["trommel", 0.54], t: ["trommel", 0.3] } },
        b: { kind: "drum", steps: "T.rtT.rtT.rtTrtt", hits: { T: ["trommel", 0.58], t: ["trommel", 0.32], r: ["trommel_rim", 0.26] } },
      },
    },
    // 衬底（合成）
    pad: { inst: "strings", gain: 0.13, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 55, high: 72, size: 3 } },
    pz: { inst: "pizz", gain: 0.18, pan: 0.05, reverb: 0.16, pattern: { kind: "arp", low: 29, steps: "1 . . . 5 . . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "F | C | F | F",
      lines: { carillon: "c'2 a2 f2 a2 | g2 e2 c2 e2 | f2 a2 c'2 a2 | f8" },
    },
    A: {
      bars: 8,
      chords: "F | C | Dm | C | Bb | F | C | F",
      lines: {
        mel: "F2 A2 c3 d | c2 e2 g4 | f3 e d2 A2 | G2 c2 e4 | d2 B2 d3 f | c2 A2 F4 | G2 c2 e2 g2 | f8",
      },
    },
    A2: {
      bars: 8,
      chords: "Dm | Gm | C | F | Bb | Gm | C | F",
      lines: {
        mel2: "A2 d2 f3 e | d2 B2 G4 | c2 e2 c3 G | A2 c2 f4 | d3 c B2 d2 | B2 G2 B3 d | c2 e2 d2 c2 | A4 F4",
      },
    },
    B: {
      bars: 8,
      chords: "F | Bb | F | C | Dm | Bb | C | C",
      lines: {
        // 附点的小跳步
        bmel: "c>d c A c2 f2 | d>e d B d2 f2 | c>d c A F2 A2 | G>A G E G4 | f>e d A d2 f2 | d>c B F B2 d2 | c>d e c g2 e2 | c2 G2 c4",
      },
    },
    outro: {
      bars: 4,
      chords: "Bb | C | F | F",
      lines: {
        tag: "d2 B2 d3 f | G2 c2 e2 g2 | f8 | z8",
        carillon: "z8 | z8 | c'2 a2 f2 a2 | f8",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "carillon:bells regal", dyn: 0.52, to: 0.6 },
      { s: "A", play: "mel:corn sack regal pz", dyn: 0.64 },
      { s: "A2", play: "mel2:crum mel2:crum2~-2 sack regal trom.a pz", dyn: 0.64 },
      { s: "B", play: "bmel:shawm sack trom.b pad pz", dyn: 0.68, to: 0.72 },
      { s: "A2", play: "mel2:corn mel2:crum mel2:crum2~-2 sack regal trom.a pad pz", dyn: 0.72, to: 0.68 },
      { s: "outro", play: "tag:corn carillon:bells sack regal pad", dyn: 0.62, to: 0.46, rit: 0.86 },
    ],
    [
      { s: "intro", play: "carillon:bells regal", dyn: 0.52, to: 0.58 },
      { s: "A", play: "mel:corn sack regal pz", dyn: 0.62 },
      { s: "B", play: "bmel:shawm sack trom.b pz", dyn: 0.66 },
      { s: "A", play: "mel:corn mel:shawm sack regal trom.a pad pz", dyn: 0.68 },
      { s: "A2", play: "mel2:corn mel2:crum mel2:crum2~-2 sack regal trom.a pad pz", dyn: 0.72, to: 0.68 },
      { s: "outro", play: "tag:corn carillon:bells sack regal pad", dyn: 0.62, to: 0.46, rit: 0.86 },
    ],
  ],
  rest: [10, 18],
};
