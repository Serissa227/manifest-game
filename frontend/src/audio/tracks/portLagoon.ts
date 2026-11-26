// 《潟湖的船歌》：意大利人的港口（威尼斯、热那亚、里窝那、拉古萨、马耳他、科孚……）的第二首——潟湖里的小船一摇一摇，
// 船夫隔着水道一句接一句地唱。与《商馆与凉廊》轮着放（那一首是 4/4 的管乐合奏，这一首是 6/8 的摇荡）。
// 第九批 A01（2026-11-11）新写，旋律原创。C 大调，6/8 拍（每分钟 84 个四分音符，附点四分音符一拍 56：船桨的一推一收）：
// - 引子：鲁特琴的分解和弦，便携管风琴起一句；
// - A：中音竖笛唱主题；再来时次中音竖笛在下面三度、六度地陪着（两条船上的两个人），簧管风琴的长音与铃鼓轻轻跟上；
// - B：转到 A 小调一侧，维奥尔琴唱一段更深的句子，借 D 大三和弦的升 F 落到属和弦上；
// - 最后一遍 A 便携管风琴低八度跟着；尾声收在主和弦上。
// 弦乐群与拨奏低音只做极轻的衬底（管弦版换成真的弦乐）。
import type { TrackDef } from "../score";

const MEL = "g3 e2 g | d3 B2 d | c3 e2 a | g3 e3 | a3 f2 c' | g3 e2 c | d2 f g2 b | c'6";

export const PORT_LAGOON: TrackDef = {
  id: "port_lagoon",
  title: { zh: "潟湖的船歌" },
  qpm: 84,
  meter: [6, 8],
  key: "C major",
  level: 1.22,
  space: 1.05,
  voices: {
    reca: { inst: "rec_alto", gain: 0.5, pan: 0.08, reverb: 0.36 },
    rect: { inst: "rec_tenor", gain: 0.42, pan: 0.2, reverb: 0.36 },
    gamba: { inst: "gamba", gain: 0.54, pan: -0.12, reverb: 0.32 },
    org: { inst: "organetto", gain: 0.4, pan: -0.2, reverb: 0.34 },
    larp: { inst: "liuto", gain: 0.34, pan: 0.3, reverb: 0.28, pattern: { kind: "arp", low: 48, steps: "1 5 8 10 8 5", ring: 2 } },
    regal: { inst: "regal", gain: 0.15, pan: -0.26, reverb: 0.4, pattern: { kind: "pad", low: 52, high: 69, size: 3 } },
    tamb: { inst: "perc", gain: 0.24, pan: 0.2, reverb: 0.26, pattern: { kind: "drum", steps: "T..s.t", hits: { T: ["tamburello", 0.46], s: ["tamburello_shake", 0.28], t: ["tamburello", 0.28] } } },
    // 衬底（合成）
    pad: { inst: "strings", gain: 0.14, pan: -0.2, reverb: 0.44, pattern: { kind: "pad", low: 55, high: 72, size: 3 } },
    pz: { inst: "pizz", gain: 0.18, pan: 0.05, reverb: 0.16, pattern: { kind: "arp", low: 36, steps: "1 . . 5, . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "C | F | C | G",
      lines: { motif: "z6 | z6 | e3 g3 | d6" },
    },
    A: {
      bars: 8,
      chords: "C | G | Am | Em | F | C | Dm*3 G*3 | C",
      lines: {
        mel: MEL,
        // 次中音竖笛在下面三度、六度
        duo: "e3 c2 e | B3 G2 B | A3 c2 e | e3 B3 | f3 c2 f | e3 c2 G | F2 A B2 d | e6",
      },
    },
    B: {
      bars: 8,
      chords: "Am | Em | F | C | Dm | Am | D | G",
      lines: {
        bmel: "A3 c2 e | e3 B2 G | A3 c2 f | e3 c3 | d3 f2 a | e3 c2 A | ^F3 A2 d | B6",
      },
    },
    outro: {
      bars: 4,
      chords: "F | G | C | C",
      lines: { tag: "a3 f2 c' | b2 g d2 g | c'6 | z6" },
    },
  },
  forms: [
    [
      { s: "intro", play: "motif:org larp", dyn: 0.5, to: 0.56 },
      { s: "A", play: "mel:reca larp pz", dyn: 0.6 },
      { s: "A", play: "mel:reca duo:rect larp regal pz tamb", dyn: 0.64 },
      { s: "B", play: "bmel:gamba larp pad pz", dyn: 0.62, to: 0.66 },
      { s: "A", play: "mel:reca mel:org-12 duo:rect larp regal pad pz tamb", dyn: 0.68, to: 0.64 },
      { s: "outro", play: "tag:reca larp pad", dyn: 0.58, to: 0.42, rit: 0.82 },
    ],
    [
      { s: "intro", play: "motif:org larp", dyn: 0.5, to: 0.54 },
      { s: "A", play: "mel:org-12 larp pz", dyn: 0.58 },
      { s: "B", play: "bmel:gamba larp pad pz", dyn: 0.6 },
      { s: "A", play: "mel:reca duo:rect larp regal pz tamb", dyn: 0.64 },
      { s: "B", play: "bmel:org bmel:gamba larp regal pad pz", dyn: 0.64, to: 0.68 },
      { s: "A", play: "mel:reca mel:org-12 duo:rect larp regal pad pz tamb", dyn: 0.68, to: 0.64 },
      { s: "outro", play: "tag:reca larp pad", dyn: 0.58, to: 0.42, rit: 0.82 },
    ],
  ],
  rest: [10, 18],
};
