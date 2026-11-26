// 《海峡的西风》：北海与英吉利海峡、波罗的海（伦敦、安特卫普、迪耶普、汉堡、吕贝克之间的窄海）——西风一起，满海峡的船都往东北跑。
// 与《柯克船的号子》在同一片海轮着放。第九批 A01（2026-11-11）新写，旋律原创。
// E 多利亚，9/8 拍（每分钟 126 个四分音符，附点四分音符一拍 84，一小节三拍：“长短、长短、长短”的滑步吉格）：
// - 引子：手摇弦琴的持续音弦嗡着，班多拉琴拨低音，小鼓敲着，三孔笛在高处吹一句；
// - A：雷贝克琴领奏，一路小跑的句子（E 小 → D → E 小 → B 小）；再来时三孔笛跟着齐奏；
// - B：落到 G 大调一侧，手摇弦琴接过去唱一段更沉的舞曲（诺曼底、布列塔尼那边的转圈舞），中间借 A 大三和弦亮一下；
// - 最后一遍 A 三孔笛在雷贝克上方吹长音的对旋律；尾声收在主音上。
// 弦乐群与拨奏低音只做极轻的衬底（管弦版换成真的弦乐）。
import type { TrackDef } from "../score";

export const SEA_CHANNEL: TrackDef = {
  id: "sea_channel",
  title: { zh: "海峡的西风" },
  qpm: 126,
  meter: [9, 8],
  key: "E dorian",
  level: 1.11,
  voices: {
    reb: { inst: "rebeck", gain: 0.54, pan: -0.14, reverb: 0.32 },
    pipe: { inst: "tabor_pipe", gain: 0.36, pan: 0.16, reverb: 0.34 },
    hg: { inst: "hurdygurdy", gain: 0.5, pan: 0.04, reverb: 0.3 },
    hd: { inst: "hurdy_drone", gain: 0.2, pan: 0.04, reverb: 0.3, pattern: { kind: "drone", notes: [52, 59] } },
    band: { inst: "bandora", gain: 0.36, pan: 0.28, reverb: 0.22, pattern: { kind: "arp", low: 40, steps: "1 . 5 8 . 5 8 . 5", ring: 2 } },
    tab: {
      inst: "perc",
      gain: 0.32,
      pan: 0.14,
      reverb: 0.24,
      pattern: {
        a: { kind: "drum", steps: "T..T..T.t", hits: { T: ["taborin", 0.56], t: ["taborin", 0.32] } },
        b: { kind: "drum", steps: "T.rT.rTrr", hits: { T: ["taborin", 0.58], r: ["taborin_rim", 0.3] } },
      },
    },
    // 衬底（合成）
    pad: { inst: "strings", gain: 0.14, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 55, high: 72, size: 3 } },
    pz: { inst: "pizz", gain: 0.18, pan: 0.05, reverb: 0.16, pattern: { kind: "arp", low: 40, steps: "1 . . 5, . . 1 . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "Em | Em | D | Em",
      lines: { call: "z9 | z9 | a2 f d2 f a3 | b9" },
    },
    A: {
      bars: 8,
      chords: "Em | D | Em | Bm | Em | G | D | Em",
      lines: {
        mel: "B2 e e2 f g2 e | f2 d d2 e f2 a | g2 e e2 d B2 d | f2 d B2 A B3 | B2 e e2 f g2 e | g2 b a2 g d2 g | f2 a f2 d A2 d | e2 f g2 f e3",
        // 三孔笛的长音对旋律
        desc: "b3 g3 b3 | a3 f3 a3 | b3 g3 e3 | f3 d3 f3 | b3 g3 b3 | d'3 b3 g3 | a3 f3 a3 | g3 f3 e3",
      },
    },
    B: {
      bars: 8,
      chords: "G | D | G | Em | A | D | Em*6 Bm*3 | Em",
      lines: {
        bmel: "G2 B d2 B G2 B | A2 d f2 d A3 | B2 d g2 d B2 d | e2 B G2 B e3 | c2 e a2 e c2 e | d2 f a2 f d3 | e2 g e2 B d2 B | B2 d e6",
      },
    },
    outro: {
      bars: 4,
      chords: "G | D | Em | Em",
      lines: { tag: "g2 b a2 g d2 g | f2 a f2 d A2 d | e2 f g2 f e3 | e9" },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:pipe hd band tab.a", dyn: 0.54, to: 0.62 },
      { s: "A", play: "mel:reb hd band tab.a", dyn: 0.64 },
      { s: "A", play: "mel:reb mel:pipe hd band tab.a pz", dyn: 0.68 },
      { s: "B", play: "bmel:hg hd band tab.b pad pz", dyn: 0.68, to: 0.72 },
      { s: "A", play: "mel:reb desc:pipe hd band tab.b pad pz", dyn: 0.74 },
      { s: "outro", play: "tag:reb hd band tab.a pad", dyn: 0.62, to: 0.44, rit: 0.84 },
    ],
    [
      { s: "intro", play: "call:pipe hd band", dyn: 0.52, to: 0.6 },
      { s: "A", play: "mel:pipe hd band tab.a", dyn: 0.62 },
      { s: "B", play: "bmel:hg hd band tab.a pz", dyn: 0.66 },
      { s: "B", play: "bmel:hg bmel:reb hd band tab.b pad pz", dyn: 0.7 },
      { s: "A", play: "mel:reb desc:pipe hd band tab.b pad pz", dyn: 0.74 },
      { s: "outro", play: "tag:reb hd band tab.a pad", dyn: 0.62, to: 0.44, rit: 0.84 },
    ],
  ],
  rest: [25, 45],
};
