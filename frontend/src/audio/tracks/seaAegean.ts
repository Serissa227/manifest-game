// 《群岛的夏风》：爱琴海与黎凡特的海（爱琴海的群岛、黎凡特海、马尔马拉海、黑海）——夏天的北风“梅尔特米”把船从一座岛吹到下一座岛。
// 与《雪松与珊瑚》在同一片海轮着放。第九批 A01（2026-11-11）新写，旋律原创。
// 写成海岛的“瑟尔托斯”舞（syrtos）：4/4 拍里的 3 + 3 + 2（咚 · · 哒 · · 哒 ·），拉着手的一长串人顺着节拍往右踏步；
// E 上的希贾兹（E F 升G A B C D：小二度接增二度），每分钟 104 拍——
// - 引子：劳托琴扫着空弦，奈伊笛吹一句自由的引子，落在主音上；
// - A：爱琴海的里拉琴（竖着拉的三弦琴）领奏，句尾是希贾兹的收束（F → 升G → E）；再来时卡农琴高八度跟着（齐奏里各走各的装饰）；
// - B：往上走到 A 小调一带，奈伊笛唱高处的一段，绕着升 G 与 A 打转，最后一级级落回 E；
// - 最后一遍 A 里拉琴、奈伊笛、卡农琴一起，达布卡与本迪尔框鼓全上。
// 劳托琴只扫大三、小三和弦与空五度；衬底是很轻的持续音与拨奏低音（管弦版换成真的弦乐）。
import type { TrackDef } from "../score";

export const SEA_AEGEAN: TrackDef = {
  id: "sea_aegean",
  title: { zh: "群岛的夏风" },
  qpm: 104,
  meter: [4, 4],
  key: "E hijaz",
  voices: {
    lyra: { inst: "lyra", gain: 0.56, pan: -0.12, reverb: 0.32 },
    nay: { inst: "nay", gain: 0.5, pan: 0.14, reverb: 0.4 },
    kanun: { inst: "kanun", gain: 0.34, pan: 0.28, reverb: 0.3 },
    lstrum: {
      inst: "laouto",
      gain: 0.3,
      pan: -0.3,
      reverb: 0.22,
      pattern: {
        a: { kind: "strum", low: 40, high: 64, steps: "D . . D . . D ." },
        b: { kind: "strum", low: 40, high: 64, steps: "D . u D . u D u" },
      },
    },
    darb: {
      inst: "perc",
      gain: 0.36,
      pan: 0.1,
      reverb: 0.22,
      pattern: {
        a: { kind: "drum", steps: "D..t..t.", hits: { D: ["darb_doum", 0.62], t: ["darb_tek", 0.4] } },
        b: { kind: "drum", steps: "D.kt.kt.D.kt.ktk", hits: { D: ["darb_doum", 0.64], t: ["darb_tek", 0.42], k: ["darb_ka", 0.24] } },
      },
    },
    bend: { inst: "perc", gain: 0.26, pan: -0.16, reverb: 0.3, pattern: { kind: "drum", steps: "B.....b.", hits: { B: ["bendir", 0.56], b: ["bendir_tek", 0.3] } } },
    // 衬底（合成）
    drone: { inst: "drone", gain: 0.16, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 52, high: 71, size: 2 } },
    pz: { inst: "pizz", gain: 0.2, pan: 0.05, reverb: 0.16, pattern: { kind: "arp", low: 40, steps: "1 . . 1 . . 5 .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "E5 | E5 | E5 | E5",
      lines: { taq: "z8 | B4 c2 B2 | A2 G F G4 | E8" },
    },
    A: {
      bars: 8,
      chords: "E | E | Am | E | Dm | Am | F*4 E*4 | E",
      lines: {
        mel: "E2 G A B2 c B | A G F G A2 B2 | c2 B A c2 e2 | d c B A G2 E2 | F2 A d f2 e d | c B A c B2 A2 | A2 c A G2 B2 | A G F G E4",
      },
    },
    B: {
      bars: 8,
      chords: "Am | Am | Dm | E | Am | F | E | E",
      lines: {
        bmel: "e2 c e a2 g a | b a g a e4 | f2 d f a2 f d | e d c B G2 B2 | c2 e a c'2 b a | a g f a c'2 a2 | g2 b a g f e d | c B A G E4",
      },
    },
    outro: {
      bars: 2,
      chords: "E | E",
      lines: { tag: "c B A G F2 G2 | E8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "taq:nay lstrum.a drone", dyn: 0.52, to: 0.6 },
      { s: "A", play: "mel:lyra lstrum.a darb.a pz", dyn: 0.64 },
      { s: "A", play: "mel:lyra mel:kanun+12 lstrum.b darb.a bend drone pz", dyn: 0.68 },
      { s: "B", play: "bmel:nay lstrum.a darb.b drone pz", dyn: 0.66, to: 0.7 },
      { s: "A", play: "mel:lyra mel:nay mel:kanun+12 lstrum.b darb.b bend drone pz", dyn: 0.74 },
      { s: "outro", play: "tag:lyra lstrum.a drone", dyn: 0.6, to: 0.42, rit: 0.82 },
    ],
    [
      { s: "intro", play: "taq:nay lstrum.a drone", dyn: 0.52, to: 0.58 },
      { s: "A", play: "mel:kanun lstrum.a darb.a pz", dyn: 0.62 },
      { s: "B", play: "bmel:lyra lstrum.a darb.a bend drone pz", dyn: 0.66 },
      { s: "B", play: "bmel:nay bmel:kanun lstrum.b darb.b bend drone pz", dyn: 0.7 },
      { s: "A", play: "mel:lyra mel:nay mel:kanun+12 lstrum.b darb.b bend drone pz", dyn: 0.74 },
      { s: "outro", play: "tag:lyra lstrum.a drone", dyn: 0.6, to: 0.42, rit: 0.82 },
    ],
  ],
  rest: [25, 45],
};
