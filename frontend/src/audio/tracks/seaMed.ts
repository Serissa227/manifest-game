// 《亚得里亚的帆影》：意大利与地中海（威尼斯与热那亚的商船队、拉古萨、希腊的群岛）。
// G 多利亚（还原 E：多利亚的六级，C 大三和弦是它的颜色），4/4 拍（每分钟 88 拍），写成文艺复兴的帕凡舞：长—短—短（二分、四分、四分）的庄重步子，
// 像威尼斯的大桨帆船在亚得里亚海上一下下划；塔博鼓照帕凡舞的步子轻轻敲。
// 第九批配乐·地方特色第二阶段重编：文艺复兴的意大利乐器领奏，旋律与和声不变（原来借曼陀林、提琴、圆号与弦乐的音色都换掉了）：
// - 开头萨克布在低处吹起全作的起帆动机（D → G → D）；
// - A 段两把鲁特琴（威尼斯 1508 年印的达尔扎的鲁特琴帕凡舞就是这个样子）：一把弹旋律、一把弹分解和弦，低音维奥尔一拍半一个长音；
//   再来时高音维奥尔唱带附点的变奏；
// - B 段转到降 B 大调一侧，是圣马可的“短号与萨克布”：短号在上面唱，萨克布吹一条众赞歌式的内声部，簧管风琴铺和弦，
//   经过 C 小三和弦与 D 七和弦回到 G 多利亚；
// - 最后一遍 A 段短号领、高音竖笛高八度，收尾回到鲁特琴。
// 弦乐群与拨奏低音只做极轻的衬底（管弦版换成真的弦乐）。与经典世界的《维斯塔海的风》（G 混合利底亚 6/8 的号子）、港口曲《白墙与钟楼》（塔兰泰拉）都不同。
import type { TrackDef } from "../score";

export const SEA_MED: TrackDef = {
  id: "sea_med",
  title: { zh: "亚得里亚的帆影", en: "Sails on the Adriatic" },
  qpm: 88,
  meter: [4, 4],
  key: "G dorian",
  voices: {
    liuto: { inst: "liuto", gain: 0.8, pan: 0.18, reverb: 0.3 },
    gamba: { inst: "gamba", gain: 0.54, pan: -0.16, reverb: 0.32 },
    cornett: { inst: "cornett", gain: 0.54, pan: -0.22, reverb: 0.36 },
    recs: { inst: "rec_soprano", gain: 0.36, pan: 0.06, reverb: 0.3 },
    organ: { inst: "organetto", gain: 0.4, pan: 0.14, reverb: 0.34 },
    sackbut: { inst: "sackbut", gain: 0.4, pan: -0.32, reverb: 0.38 },
    larp: { inst: "liuto", gain: 0.32, pan: 0.3, reverb: 0.26, pattern: { kind: "arp", low: 43, steps: "1 5 8 10 8 5 8 10", ring: 2 } },
    regal: { inst: "regal", gain: 0.22, pan: 0.04, reverb: 0.34, pattern: { kind: "pad", low: 50, high: 67, size: 3 } },
    gbass: { inst: "gamba", gain: 0.4, pan: 0.22, reverb: 0.24, pattern: { kind: "arp", low: 36, steps: "1 . . . 5, . . ." } },
    taborin: { inst: "perc", gain: 0.45, pan: -0.06, reverb: 0.24, pattern: { kind: "drum", steps: "X...x.x.", hits: { X: ["tambori", 0.42], x: ["tambori_soft", 0.3] } } },
    // 衬底（合成）：极轻的弦乐长音与拨奏低音
    pad: { inst: "strings", gain: 0.16, pan: 0.16, reverb: 0.42, pattern: { kind: "pad", low: 55, high: 72, size: 3 } },
    pz: { inst: "pizz", gain: 0.16, pan: 0.06, reverb: 0.16, pattern: { kind: "arp", low: 31, steps: "1 . . . . . . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "Gm | Gm | Gm | D",
      // 起帆动机（D → G → D），萨克布在低处
      lines: { motif: "z8 | z6 D,3/2 G,/2 | D8 | z8" },
    },
    A: {
      bars: 8,
      // 帕凡舞：二分、四分、四分
      chords: "Gm | F | C | D | Gm | Bb | C D | Gm",
      lines: {
        mel: "G4 A2 B2 | c4 B2 A2 | G4 E2 G2 | A6 z2 | d4 c2 B2 | d4 f2 d2 | e2 c2 A2 ^F2 | G8",
        // 带附点的变奏
        mel2: "G3 A B2 c2 | c3 d c B A2 | G3 F E2 G2 | A6 z2 | d3 e d c B2 | d3 e f2 d2 | e2 c2 A2 ^F2 | G8",
      },
    },
    B: {
      bars: 8,
      chords: "Bb | F | Gm | D | Eb | Bb | Cm | D7",
      lines: {
        bmel: "f4 d2 f2 | a4 g2 f2 | g4 d2 B2 | ^f6 z2 | g4 _e2 B2 | f4 d2 B2 | c4 _e2 g2 | ^f4 a4",
        // 圣马可的萨克布：众赞歌式的内声部
        chorale: "B,4 D4 | C4 A,4 | B,4 D4 | A,6 z2 | B,4 G,4 | F,4 B,4 | C4 _E4 | D8",
      },
    },
    outro: { bars: 2, chords: "Cm D | Gm", lines: { tag: "c2 B2 A2 ^F2 | G8" } },
  },
  forms: [
    [
      { s: "intro", play: "motif:sackbut larp regal taborin", dyn: 0.54, to: 0.62 },
      { s: "A", play: "mel:liuto larp gbass taborin pz", dyn: 0.64 },
      { s: "A", play: "mel2:gamba larp pad gbass taborin pz", dyn: 0.66 },
      { s: "B", play: "bmel:cornett chorale:sackbut regal pad gbass taborin pz", dyn: 0.68, to: 0.72 },
      { s: "A", play: "mel2:cornett mel2:recs+12 larp regal pad gbass taborin pz", dyn: 0.72 },
      { s: "outro", play: "tag:liuto larp pad gbass", dyn: 0.6, to: 0.4, rit: 0.82 },
    ],
    [
      { s: "intro", play: "motif:sackbut larp", dyn: 0.52, to: 0.6 },
      { s: "A", play: "mel:gamba larp gbass taborin pz", dyn: 0.62 },
      { s: "B", play: "bmel:organ chorale:sackbut pad gbass pz", dyn: 0.66, to: 0.7 },
      { s: "B", play: "bmel:cornett chorale:sackbut regal pad gbass taborin pz", dyn: 0.7, to: 0.74 },
      { s: "A", play: "mel:liuto mel:gamba larp pad gbass taborin pz", dyn: 0.72 },
      { s: "outro", play: "tag:gamba larp pad gbass", dyn: 0.58, to: 0.38, rit: 0.82 },
    ],
  ],
  rest: [25, 45],
  level: 1.29,
};
