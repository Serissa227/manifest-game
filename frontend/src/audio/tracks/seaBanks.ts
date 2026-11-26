// 《大浅滩的鳕鱼船》：北大西洋的西北角（纽芬兰大浅滩、拉布拉多外海、圣劳伦斯湾、爱尔兰海）——每年春天，巴斯克人、布列塔尼人、
// 诺曼人与葡萄牙人的渔船成群地横渡过来钓鳕鱼、捕鲸，秋天满舱咸鱼回去。与《北风与白鲸》在同一片海轮着放。
// 第九批 A01（2026-11-11）新写，旋律原创。G 大调（B 段在 E 小调），5/8 拍（每分钟 96 个四分音符）：
// - A 是巴斯克的“索尔齐科”（zortziko）：5/8 里一短、两个附点（哒 · 哒—哒 哒—哒），三孔笛（巴斯克的“奇斯图”）领奏，它自己的小鼓敲同一个节奏；
//   再来时雷贝克琴低八度跟着；
// - B 是布列塔尼的“一唱一和”（kan ha diskan）：肖姆管（布列塔尼的“邦巴德”）吹两小节，法兰西风笛（“比尼乌”）接两小节，句尾咬着句头；
// - 引子是雾里的一句雷贝克长音，尾声三孔笛收住。
// 风笛的持续音管一直托着；弦乐群与拨奏低音只做极轻的衬底（管弦版换成真的弦乐）。
import type { TrackDef } from "../score";

export const SEA_BANKS: TrackDef = {
  id: "sea_banks",
  title: { zh: "大浅滩的鳕鱼船" },
  qpm: 96,
  meter: [5, 8],
  key: "G major",
  level: 1.29,
  voices: {
    pipe: { inst: "pipe", gain: 0.4, pan: 0.14, reverb: 0.34 },
    reb: { inst: "rebeck", gain: 0.5, pan: -0.16, reverb: 0.32 },
    shawm: { inst: "shawm", gain: 0.52, pan: -0.06, reverb: 0.34 },
    corn: { inst: "cornemuse", gain: 0.46, pan: 0.1, reverb: 0.32 },
    dr: { inst: "pipe_drone", gain: 0.2, pan: 0.1, reverb: 0.32, pattern: { kind: "pad", low: 43, high: 57, size: 2 } },
    band: { inst: "bandora", gain: 0.34, pan: 0.28, reverb: 0.22, pattern: { kind: "arp", low: 43, steps: "1 . 5 8 .", ring: 2 } },
    // 索尔齐科的鼓点：哒 · 哒—哒 哒—哒（半个八分音符一格）
    tamb: { inst: "perc", gain: 0.34, pan: 0.14, reverb: 0.24, pattern: { kind: "drum", grid: 0.5, steps: "T.T..tT..t", hits: { T: ["tambori", 0.58], t: ["tambori_soft", 0.4] } } },
    // 衬底（合成）
    pad: { inst: "strings", gain: 0.14, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 55, high: 72, size: 3 } },
    pz: { inst: "pizz", gain: 0.18, pan: 0.05, reverb: 0.16, pattern: { kind: "arp", low: 31, steps: "1 . . 5 .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "G | G | D | G",
      lines: { fog: "g5 | b5 | a3 f2 | g5" },
    },
    A: {
      bars: 8,
      chords: "G | D | Em | D | G | C | D | G",
      lines: {
        mel: "g a>b d'>b | a f>a d'>a | g e>g b>g | a3 f2 | g a>b d'>b | c' g>c' e'>c' | d' a>d' c'>a | b3 g2",
      },
    },
    B: {
      bars: 8,
      chords: "Em | Em | D | Em | Em | G | D | Em",
      lines: {
        // 邦巴德起两小节
        call: "e d>e g>e | d B>d e2 | z5 | z5 | e g>e a>g | g d>e g2 | z5 | z5",
        // 比尼乌接两小节
        resp: "z5 | z5 | f d>f a>f | g e>d e2 | z5 | z5 | a f>a d>f | e B>d e2",
      },
    },
    outro: {
      bars: 4,
      chords: "C | D | G | G",
      lines: { tag: "c' g>c' e'>c' | d' a>d' c'>a | b3 g2 | g5" },
    },
  },
  forms: [
    [
      { s: "intro", play: "fog:reb dr tamb", dyn: 0.5, to: 0.58 },
      { s: "A", play: "mel:pipe band tamb", dyn: 0.64 },
      { s: "A", play: "mel:pipe mel:reb-12 band dr tamb pz", dyn: 0.68 },
      { s: "B", play: "call:shawm resp:corn band dr tamb pad pz", dyn: 0.68 },
      { s: "B", play: "call:shawm resp:corn band dr tamb pad pz", dyn: 0.72 },
      { s: "A", play: "mel:pipe mel:reb-12 band dr tamb pad pz", dyn: 0.74 },
      { s: "outro", play: "tag:pipe band dr tamb pad", dyn: 0.62, to: 0.44, rit: 0.84 },
    ],
    [
      { s: "intro", play: "fog:reb dr", dyn: 0.5, to: 0.56 },
      { s: "A", play: "mel:reb-12 band tamb", dyn: 0.62 },
      { s: "B", play: "call:shawm resp:corn band dr tamb pz", dyn: 0.66 },
      { s: "A", play: "mel:pipe mel:reb-12 band dr tamb pad pz", dyn: 0.7 },
      { s: "B", play: "call:shawm resp:corn band dr tamb pad pz", dyn: 0.72 },
      { s: "A", play: "mel:pipe mel:reb-12 band dr tamb pad pz", dyn: 0.74 },
      { s: "outro", play: "tag:pipe band dr tamb pad", dyn: 0.62, to: 0.44, rit: 0.84 },
    ],
  ],
  rest: [25, 45],
};
