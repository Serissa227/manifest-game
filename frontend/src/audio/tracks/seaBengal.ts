// 《恒河口的船歌》：印度沿岸的海（孟加拉湾、科罗曼德尔与马拉巴尔外海、古吉拉特海、锡兰周围）——恒河口的船夫顺水放船时唱的长调，
// 一个人在船尾摇橹，声音顺着水面飘出去很远。与《雨季的船歌》在同一片海轮着放（那一首是 6/8 的雨季，这一首是 7 拍的夜航）。
// 第九批 A01（2026-11-11）新写，旋律原创。D 上的卡菲（kafi，同多利亚：D E F G A B C），7/8 拍——北印度的“鲁帕克”塔拉（rupak，3 + 2 + 2），
// 每分钟 92 个四分音符：
// - 引子（alap）：坦布拉的持续音里，班苏里笛慢慢吹出主音与下面几个音，没有鼓；
// - A（sthayi）：班苏里笛在中低音区唱主题，塔布拉敲鲁帕克的鼓经（tin tin na · dhin na · dhin na），多塔拉拨着固定音型；再来时萨朗吉跟着；
// - B（antara）：萨朗吉往高处走（A → 高音 D → F），句尾与 A 同一个收束（F → E → D）；
// - 最后一遍 A 两件一起。尾声落回主音。
// 不写三和弦：只有空五度的持续音；衬底是很轻的弦乐长音与拨奏低音（管弦版换成真的弦乐）。
import type { TrackDef } from "../score";

export const SEA_BENGAL: TrackDef = {
  id: "sea_bengal",
  title: { zh: "恒河口的船歌" },
  qpm: 92,
  meter: [7, 8],
  key: "D dorian",
  level: 1.08,
  space: 1.1,
  voices: {
    bans: { inst: "bansuri", gain: 0.54, pan: -0.12, reverb: 0.42 },
    sar: { inst: "sarangi", gain: 0.5, pan: 0.14, reverb: 0.36 },
    dot: { inst: "dotara", gain: 0.3, pan: 0.3, reverb: 0.26, pattern: { kind: "arp", low: 55, steps: "1 . 5 8 . 5 8", ring: 2 } },
    tanp: { inst: "tanpura", gain: 0.26, pan: -0.3, reverb: 0.36, pattern: { kind: "arp", low: 50, steps: "5 . 8 8 . 1 .", ring: 4 } },
    // 鲁帕克：tin tin na | dhin na | dhin na（右手鼓一拍一下，左手鼓落在两个 dhin 上）
    tabr: { inst: "perc", gain: 0.3, pan: 0.1, reverb: 0.22, pattern: { kind: "drum", steps: "ttnTnTn", hits: { t: ["tabla_tin", 0.44], n: ["tabla_na", 0.4], T: ["tabla_tin", 0.52] } } },
    tabl: { inst: "perc", gain: 0.3, pan: 0.02, reverb: 0.22, pattern: { kind: "drum", steps: "...g.g.", hits: { g: ["bayan_ge", 0.5] } } },
    // 衬底（合成）
    pad: { inst: "strings", gain: 0.13, pan: -0.2, reverb: 0.44, pattern: { kind: "pad", low: 50, high: 69, size: 2 } },
    pz: { inst: "pizz", gain: 0.18, pan: 0.05, reverb: 0.16, pattern: { kind: "arp", low: 38, steps: "1 . . 1 . 5 .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "D5 | D5 | D5 | D5",
      lines: { alap: "D7- | D3 E2 F2 | !vib!G4 F E D | D7" },
    },
    A: {
      bars: 8,
      chords: "D5 | D5 | G5 | D5 | C5 | D5 | A5 | D5",
      lines: {
        mel: "D3 F2 G2 | A3 G2 F2 | G3 B2 A2 | A2 G F2 E D | E3 G2 c2 | d3 c2 A2 | c2 B A2 G2 | F2 E D4",
      },
    },
    B: {
      bars: 8,
      chords: "D5 | D5 | A5 | D5 | G5 | D5 | A5 | D5",
      lines: {
        bmel: "A3 c2 d2 | d3 e2 f2 | e3 d2 c2 | !vib!d4 z3 | d2 e d2 c B | A3 d2 c2 | B2 A G2 A2 | !slide!F2 E D4",
      },
    },
    outro: {
      bars: 4,
      chords: "G5 | A5 | D5 | D5",
      lines: { tag: "G3 B2 A2 | c2 B A2 G2 | F2 E D4 | D7" },
    },
  },
  forms: [
    [
      { s: "intro", play: "alap:bans tanp", dyn: 0.5, to: 0.56 },
      { s: "A", play: "mel:bans tanp dot tabr tabl pz", dyn: 0.62 },
      { s: "A", play: "mel:bans mel:sar tanp dot tabr tabl pad pz", dyn: 0.66 },
      { s: "B", play: "bmel:sar tanp dot tabr tabl pad pz", dyn: 0.66, to: 0.7 },
      { s: "A", play: "mel:bans mel:sar tanp dot tabr tabl pad pz", dyn: 0.7, to: 0.66 },
      { s: "outro", play: "tag:bans tanp dot pad", dyn: 0.58, to: 0.42, rit: 0.82 },
    ],
    [
      { s: "intro", play: "alap:bans tanp", dyn: 0.5, to: 0.54 },
      { s: "A", play: "mel:sar tanp dot tabr tabl pz", dyn: 0.6 },
      { s: "B", play: "bmel:bans tanp dot tabr tabl pad pz", dyn: 0.64 },
      { s: "B", play: "bmel:sar bmel:bans tanp dot tabr tabl pad pz", dyn: 0.68, to: 0.7 },
      { s: "A", play: "mel:bans mel:sar tanp dot tabr tabl pad pz", dyn: 0.7, to: 0.66 },
      { s: "outro", play: "tag:bans tanp dot pad", dyn: 0.58, to: 0.42, rit: 0.82 },
    ],
  ],
  rest: [25, 45],
};
