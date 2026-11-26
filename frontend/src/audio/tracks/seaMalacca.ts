// 《海峡的甘布斯》：马来世界的海（马六甲海峡、南海南部、暹罗湾、爪哇海与香料群岛之间）——海峡两岸的港口里，
// 哈德拉毛来的阿拉伯商人带来了甘布斯琴与“扎宾”舞（zapin），马来人把它跳成了自己的。与《丁香群岛的铜锣》在同一片海轮着放
// （那一首是爪哇的甘美兰，这一首是海峡的弦与鼓）。第九批 A01（2026-11-11）新写，旋律原创。
// D 小调（A 大三和弦上的升 C 与降 B 挨着，是阿拉伯带来的味道），4/4 拍（每分钟 100 拍）：
// - 引子（taksim）：甘布斯独自拨一段，鼓不进来；
// - A：甘布斯领奏，几只马尔瓦斯小鼓咬合着敲（咚 · 哒哒 咚 · 哒 ·），框鼓与吊锣压着句头；再来时雷巴布（竖着拉的二弦琴）跟着齐奏；
// - B：转到 F 大调一侧，苏灵笛吹一段开阔的句子（出了海峡），雷巴布在下面；
// - 最后一遍 A 甘布斯、雷巴布、苏灵笛一起；尾声是扎宾收尾的那几下齐奏的重拍（wainab）。
// 衬底是很轻的持续音与拨奏低音（管弦版换成真的弦乐）。
import type { TrackDef } from "../score";

export const SEA_MALACCA: TrackDef = {
  id: "sea_malacca",
  title: { zh: "海峡的甘布斯" },
  qpm: 100,
  meter: [4, 4],
  key: "D minor",
  level: 1.19,
  voices: {
    gam: { inst: "gambus", gain: 0.56, pan: -0.14, reverb: 0.28 },
    reb: { inst: "rebab", gain: 0.46, pan: 0.16, reverb: 0.34 },
    sul: { inst: "suling", gain: 0.46, pan: 0.06, reverb: 0.38 },
    mar: {
      inst: "perc",
      gain: 0.36,
      pan: 0.14,
      reverb: 0.22,
      pattern: {
        a: { kind: "drum", steps: "D.tkD.t.", hits: { D: ["mirwas_dum", 0.6], t: ["mirwas_tak", 0.4], k: ["mirwas_tak", 0.24] } },
        b: { kind: "drum", steps: "D.ttD.tkD.ttDtkt", hits: { D: ["mirwas_dum", 0.62], t: ["mirwas_tak", 0.42], k: ["mirwas_tak", 0.24] } },
      },
    },
    terb: { inst: "perc", gain: 0.28, pan: -0.2, reverb: 0.26, pattern: { kind: "drum", steps: "T..t..t.", hits: { T: ["terbang_dung", 0.54], t: ["terbang_tak", 0.3] } } },
    gong: { inst: "kempul", gain: 0.3, pan: 0.02, reverb: 0.4, pattern: { kind: "arp", low: 38, steps: "1 . . . . . . . . . . . . . . .", ring: 8 } },
    // 衬底（合成）
    drone: { inst: "drone", gain: 0.15, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 50, high: 69, size: 2 } },
    pz: { inst: "pizz", gain: 0.2, pan: 0.05, reverb: 0.16, pattern: { kind: "arp", low: 38, steps: "1 . . 1 . . 5 .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "Dm | Dm | A | Dm",
      lines: { taq: "D4 A4 | d2 c B A2 G2 | ^c2 B A B2 ^c2 | !trem!d8" },
    },
    A: {
      bars: 8,
      chords: "Dm | Dm | Gm | Dm | C | Dm | A | Dm",
      lines: {
        mel: "D2 F G A2 d2 | c B A G A4 | G2 B d c B A G | F G A F D4 | E2 G c e2 c2 | d c B A F2 A2 | ^c2 e d ^c B A G | F E D E D4",
      },
    },
    B: {
      bars: 8,
      chords: "F | C | Dm | A | Bb | F | Gm*4 A*4 | Dm",
      lines: {
        bmel: "c4 A2 c2 | e3 d c2 G2 | f4 d2 f2 | e3 d ^c2 A2 | d4 B2 d2 | c3 B A2 F2 | G2 B2 A2 ^c2 | d8",
        // 雷巴布在下面三度、六度
        bcnt: "A4 F2 A2 | G3 F E2 E2 | A4 F2 A2 | A3 G E2 E2 | F4 D2 F2 | F3 D C2 C2 | D2 D2 E2 E2 | F8",
      },
    },
    outro: {
      bars: 4,
      chords: "Dm | A | Dm | Dm",
      // wainab：齐奏的重拍
      lines: { tag: "D2 D F2 A2 d | ^c2 ^c e2 ^c2 A | d2 d A2 F2 D | D8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "taq:gam drone", dyn: 0.54, to: 0.6 },
      { s: "A", play: "mel:gam mar.a terb gong pz", dyn: 0.64 },
      { s: "A", play: "mel:gam mel:reb mar.a terb gong drone pz", dyn: 0.68 },
      { s: "B", play: "bmel:sul bcnt:reb mar.a terb gong drone pz", dyn: 0.66, to: 0.7 },
      { s: "A", play: "mel:gam mel:reb mel:sul mar.b terb gong drone pz", dyn: 0.74 },
      { s: "outro", play: "tag:gam tag:reb mar.b terb gong drone", dyn: 0.72, to: 0.6, rit: 0.9 },
    ],
    [
      { s: "intro", play: "taq:gam drone", dyn: 0.54, to: 0.6 },
      { s: "A", play: "mel:gam mar.a terb pz", dyn: 0.62 },
      { s: "B", play: "bmel:sul mar.a terb gong drone pz", dyn: 0.64 },
      { s: "B", play: "bmel:sul bcnt:reb mar.a terb gong drone pz", dyn: 0.68, to: 0.7 },
      { s: "A", play: "mel:gam mel:reb mel:sul mar.b terb gong drone pz", dyn: 0.74 },
      { s: "outro", play: "tag:gam tag:reb mar.b terb gong drone", dyn: 0.72, to: 0.6, rit: 0.9 },
    ],
  ],
  rest: [25, 45],
};
