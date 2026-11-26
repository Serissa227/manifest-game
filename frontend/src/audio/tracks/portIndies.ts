// 《总督辖区的广场》：新大陆沿岸的城镇（韦拉克鲁斯、坎佩切、卡亚俄、阿卡普尔科、瓦尔帕莱索……）的第二首——
// 石头砌的广场上，节日里西班牙人的琴与管、本地人的鼓与沙铃凑在一起。与《拓荒者的篝火》轮着放（只在势力写了风格名的世界里；
// 殖民点照旧只放《拓荒者的篝火》）。第九批 A01（2026-11-11）新写，旋律原创。
// G 大调，6/8 拍（每分钟 132 拍），6/8 与 3/4 叠着走（扫弦数两大拍，旋律有的小节数三小拍）：
// - 引子：维韦拉琴扫弦、韦韦特尔鼓与葫芦沙铃，高音竖笛吹一句；
// - A：肖姆管领奏；A′：奇里米亚把答句唱成三个四分音符一小节的宽步子，高音竖笛高八度跟着；
// - B：只剩 E 小调上的五声（E G A B D）——陶笛吹一段本地的调子，鼓往前站，扫弦退到只点重拍；
// - 最后一遍 A 全体。竖琴的分解和弦与弦乐、拨奏低音只做衬底（管弦版换成真的竖琴与弦乐）。
import type { TrackDef } from "../score";

export const PORT_INDIES: TrackDef = {
  id: "port_indies",
  title: { zh: "总督辖区的广场" },
  qpm: 132,
  meter: [6, 8],
  key: "G major",
  level: 1.04,
  voices: {
    shawm: { inst: "shawm", gain: 0.54, pan: -0.08, reverb: 0.32 },
    chir: { inst: "chirimia", gain: 0.5, pan: 0.12, reverb: 0.32 },
    recs: { inst: "rec_soprano", gain: 0.3, pan: 0.16, reverb: 0.32 },
    oca: { inst: "ocarina", gain: 0.5, pan: -0.14, reverb: 0.36 },
    vstrum: {
      inst: "vihuela",
      gain: 0.24,
      pan: 0.3,
      reverb: 0.22,
      pattern: {
        a: { kind: "strum", low: 43, high: 67, steps: "D . d U d u" },
        c: { kind: "strum", low: 43, high: 67, steps: "D . . D . ." },
      },
    },
    bajon: { inst: "bajon", gain: 0.44, pan: 0.06, reverb: 0.2, pattern: { kind: "arp", low: 43, steps: "1 . . 5, . .", ring: 2 } },
    hueh: { inst: "perc", gain: 0.34, pan: -0.06, reverb: 0.26, pattern: { kind: "drum", steps: "H..h.h", hits: { H: ["huehuetl", 0.58], h: ["huehuetl_ti", 0.34] } } },
    son: { inst: "perc", gain: 0.22, pan: 0.24, reverb: 0.22, pattern: { kind: "drum", steps: "s.ss.s", hits: { s: ["sonaja", 0.36] } } },
    tamb: { inst: "perc", gain: 0.28, pan: 0.1, reverb: 0.24, pattern: { kind: "drum", steps: "T..t.tT.tT.t", hits: { T: ["tambori", 0.54], t: ["tambori_soft", 0.34] } } },
    // 衬底（合成）
    hp: { inst: "harp", gain: 0.22, pan: -0.34, reverb: 0.32, pattern: { kind: "arp", low: 43, steps: "1 5 8 10 8 5", ring: 2 } },
    pad: { inst: "strings", gain: 0.14, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 55, high: 72, size: 3 } },
    pz: { inst: "pizz", gain: 0.18, pan: 0.05, reverb: 0.16, pattern: { kind: "arp", low: 31, steps: "1 . . 5 . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "G | C | G | D",
      lines: { call: "z6 | z6 | g2 d' b2 d' | a6" },
    },
    A: {
      bars: 8,
      chords: "G | C | G | D | G | C | D | G",
      lines: {
        mel: "d2 B d2 g | e2 c e2 g | d2 B G2 B | A2 d f2 d | g2 d B2 d | e2 g e2 c | d2 f a2 f | g6",
      },
    },
    A2: {
      bars: 8,
      chords: "Em | Bm | C | D | Em | C | D | G",
      lines: {
        // 三个四分音符一小节
        mel2: "e2 B2 G2 | d2 B2 F2 | e2 c e2 g | f2 d2 A2 | g2 e2 B2 | e2 g e2 c | d2 A2 f2 | g6",
      },
    },
    B: {
      bars: 8,
      chords: "Em | Em | G | D | Em | Em | D | D",
      lines: {
        bmel: "e3 d2 B | A2 B d2 B | g3 e2 d | d2 e d2 A | e3 g2 e | d2 B A2 G | A2 B d2 e | d6",
      },
    },
    outro: {
      bars: 4,
      chords: "C | D | G | G",
      lines: { tag: "e2 g e2 c | d2 f a2 f | g6 | z6" },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:recs vstrum.c bajon hueh son", dyn: 0.56, to: 0.64 },
      { s: "A", play: "mel:shawm vstrum.a bajon hueh son pz", dyn: 0.66 },
      { s: "A2", play: "mel2:chir mel2:recs+12 vstrum.a bajon hueh son tamb hp pz", dyn: 0.68 },
      { s: "B", play: "bmel:oca vstrum.c hueh son tamb pad", dyn: 0.64, to: 0.68 },
      { s: "A", play: "mel:shawm mel:recs+12 vstrum.a bajon hueh son tamb hp pad pz", dyn: 0.74 },
      { s: "A2", play: "mel2:chir mel2:shawm mel2:recs+12 vstrum.a bajon hueh son tamb hp pad pz", dyn: 0.74 },
      { s: "outro", play: "tag:shawm vstrum.c bajon hueh son hp pad", dyn: 0.64, to: 0.46, rit: 0.86 },
    ],
    [
      { s: "intro", play: "call:recs vstrum.c bajon son", dyn: 0.56, to: 0.62 },
      { s: "A", play: "mel:chir vstrum.a bajon hueh son pz", dyn: 0.64 },
      { s: "B", play: "bmel:oca vstrum.c hueh son tamb pad", dyn: 0.64 },
      { s: "A2", play: "mel2:chir mel2:recs+12 vstrum.a bajon hueh son tamb hp pz", dyn: 0.7 },
      { s: "B", play: "bmel:oca bmel:recs+12 vstrum.c bajon hueh son tamb hp pad", dyn: 0.7 },
      { s: "A", play: "mel:shawm mel:recs+12 vstrum.a bajon hueh son tamb hp pad pz", dyn: 0.74 },
      { s: "outro", play: "tag:shawm vstrum.c bajon hueh son hp pad", dyn: 0.64, to: 0.46, rit: 0.86 },
    ],
  ],
  rest: [10, 18],
};
