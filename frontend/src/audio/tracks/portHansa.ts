// 《鲱鱼与盐的码头》：汉萨与波罗的海、斯堪的纳维亚的港口（吕贝克、汉堡、但泽、维斯比、里加、斯德哥尔摩、卑尔根……鲱鱼、盐与木材的码头）。
// 地方特色第二阶段（北欧）：地方乐器领奏（复古合成版的衬底用合成的持续音与大提琴组）。
// 汉萨的码头有两种声音：德意志的汉萨城市（吕贝克、汉堡、但泽）里市政雇的城市乐手（Stadtpfeifer）吹克鲁姆管、敲雇佣兵的长鼓；
// 瑞典与挪威的水手、渔民在商站（卑尔根的德意志商站、斯德哥尔摩与维斯比的德意志市民区）边上拉尼克尔哈帕跳波尔斯卡。这首两种都有：
// D 小调（降 B；第七级常升高成升 C），3/4 拍，每分钟 108 拍：
// - 引子：远处的山羊角号吹一声召唤（音从下面推上来），朗格莱克琴开始扫空弦；
// - A：尼克尔哈帕（键提琴）独奏波尔斯卡（polska：每拍三个“十六分音符一组”的碎音，第二拍略早——groove），朗格莱克琴每拍一扫；
// - T：城市乐手的“后舞”（Nachtanz：德意志文艺复兴的成对舞曲里三拍子的那一支，二分—四分的长短步）——克鲁姆管三声部（高、中、低），
//   雇佣兵的长鼓在下面敲行进的鼓点；
// - A′：回到尼克尔哈帕，第二把琴在下方拉三度（瑞典的两把琴的二重奏），脚在地板上跺；B：第二段在高处，两把琴；A″：两把琴，跺脚；
//   尾声：琴收在 D 上，角号再远远地应一声。第二遍角号之后先是城市乐手，再是波尔斯卡。
// 和声记号只写空五度（D5、A5、G5、C5、F5）：波尔斯卡没有西洋的三和弦；后舞的三声部本身有文艺复兴的三和弦，衬底仍只铺空五度（像持续音）。
import type { TrackDef } from "../score";

export const PORT_HANSA: TrackDef = {
  id: "port_hansa",
  title: { zh: "鲱鱼与盐的码头", en: "Quay of Herring and Salt" },
  qpm: 108,
  meter: [3, 4],
  key: "D minor",
  groove: [0, -0.1, 0],
  voices: {
    nyck1: { inst: "nyckelharpa", gain: 0.52, pan: -0.14, reverb: 0.28 },
    nyck2: { inst: "nyckelharpa", gain: 0.4, pan: 0.2, reverb: 0.3 },
    lang: {
      inst: "langeleik",
      gain: 0.34,
      pan: 0.3,
      reverb: 0.26,
      pattern: {
        a: { kind: "strum", low: 50, high: 69, steps: "D . d . u .", spread: 0.01 },
        intro: { kind: "strum", low: 50, high: 69, steps: "- . . . . . - . . . . . D . d . u . D . d . u .", spread: 0.01 },
      },
    },
    horn: { inst: "bukkehorn", gain: 0.44, pan: 0.32, reverb: 0.55 },
    stomp: {
      inst: "perc",
      gain: 0.3,
      pan: 0.04,
      reverb: 0.26,
      pattern: {
        a: { kind: "drum", steps: "S...s.", hits: { S: ["stomp", 0.7], s: ["stomp", 0.45] } },
        coda: { kind: "drum", steps: "S...S.S.....", hits: { S: ["stomp", 0.75] } },
      },
    },
    // 城市乐手：克鲁姆管三声部（高、中、低）与雇佣兵的长鼓（3/4：咚 · 嗒嗒 咚 · 嗒 · 咚 · 嗒 ·）
    crum1: { inst: "crumhorn", gain: 0.68, pan: -0.24, reverb: 0.3 },
    crum2: { inst: "crumhorn", gain: 0.54, pan: 0.04, reverb: 0.3 },
    crum3: { inst: "crumhorn", gain: 0.66, pan: 0.24, reverb: 0.28 },
    trom: {
      inst: "perc",
      gain: 0.3,
      pan: 0.1,
      reverb: 0.3,
      pattern: { kind: "drum", grid: 0.5, steps: "T.rrT.r.T.r.", hits: { T: ["trommel", 0.75], r: ["trommel_rim", 0.42] } },
    },
    // 衬底（合成）：空五度的持续音、大提琴组的根音
    pad: { inst: "drone", gain: 0.18, pan: -0.2, reverb: 0.4, pattern: { kind: "pad", low: 50, high: 69, size: 2 } },
    low: { inst: "celli", gain: 0.2, pan: 0.12, reverb: 0.26, pattern: { kind: "arp", low: 38, steps: "1 . . . . .", ring: 6 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "D5 | D5 | D5 | D5",
      lines: { call: "A3 d3 | !bend!e4 d2 | !fall!A6 | z6" },
    },
    A: {
      bars: 8,
      chords: "D5 | D5 A5 | D5 | C5 A5 | D5 | G5 D5 | A5 | D5",
      lines: {
        mel: "d/2e/2f/2g/2 a2 f/2d/2 A | d2 ^c/2d/2e/2f/2 e2 | f/2g/2a/2b/2 c'2 b/2a/2 g | a3 g f e | d/2e/2f/2g/2 a2 d'/2c'/2 b | a/2g/2f/2e/2 f2 d2 | e/2f/2g/2e/2 ^c2 e/2c/2 A | d4 z2",
        // 第二把琴：下方三度（与六度）的二声部
        alto: "F2 f2 d2 | A2 A2 ^c2 | d2 a2 g2 | f3 e d ^c | F2 f2 b2 | f2 d2 A2 | ^c2 A2 ^c2 | A4 z2",
      },
    },
    B: {
      bars: 8,
      chords: "A5 | D5 | G5 | D5 A5 | D5 | G5 A5 | A5 | D5",
      lines: {
        bmel: "a/2b/2c'/2d'/2 e'2 d'/2c'/2 b | a2 f/2g/2a/2b/2 a2 | g/2a/2b/2a/2 g2 e/2f/2 g | f3 e d ^c | d/2f/2a/2f/2 d'2 c'/2b/2 a | b/2a/2g/2f/2 e2 a2 | d/2e/2f/2e/2 ^c2 e2 | d4 z2",
        balto: "e2 c'2 g2 | f2 d2 f2 | e2 e2 ^c2 | d3 ^c B A | F2 f2 a2 | g2 ^c2 e2 | A2 A2 ^c2 | A4 z2",
      },
    },
    // 城市乐手的后舞：高声部在 C#4–C5（克鲁姆管的音域只有九度上下），中声部在下方三度，低声部走根音
    T: {
      bars: 8,
      chords: "D5 | D5 | C5 | D5 | F5 | C5 | A5 | D5",
      lines: {
        tmel: "A4 G2 | F2 G2 A2 | G4 E2 | F3 E D2 | c4 A2 | c2 A2 G2 | E4 ^C2 | D6",
        tmid: "F4 E2 | D2 E2 F2 | E4 C2 | D3 ^C A,2 | A4 F2 | G2 F2 E2 | ^C4 A,2 | A,6",
        tbass: "D,4 A,,2 | D,2 C,2 F,,2 | C,4 A,,2 | D,3 A,, D,2 | F,4 D,2 | C,2 F,,2 C,2 | A,,4 A,,2 | D,6",
      },
    },
    coda: {
      bars: 2,
      chords: "D5 | D5",
      lines: {
        end: "d/2e/2f/2e/2 d2 A2 | d6",
        cend: "z6 | !bend!d6",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:horn lang.intro pad", dyn: 0.6, to: 0.66 },
      { s: "A", play: "mel:nyck1 lang low pad", dyn: 0.66 },
      { s: "T", play: "tmel:crum1 tmid:crum2 tbass:crum3 trom low pad", dyn: 0.68 },
      { s: "A", play: "mel:nyck1 alto:nyck2 lang stomp low pad", dyn: 0.7 },
      { s: "B", play: "bmel:nyck1 balto:nyck2 lang stomp low pad", dyn: 0.72 },
      { s: "A", play: "mel:nyck1 alto:nyck2 lang stomp low pad", dyn: 0.76 },
      { s: "coda", play: "end:nyck1 cend:horn lang stomp.coda low", dyn: 0.72, rit: 0.88 },
    ],
    [
      { s: "intro", play: "call:horn lang.intro pad", dyn: 0.58, to: 0.64 },
      { s: "T", play: "tmel:crum1 tmid:crum2 tbass:crum3 trom low pad", dyn: 0.64 },
      { s: "A", play: "mel:nyck2 lang low pad", dyn: 0.66 },
      { s: "B", play: "bmel:nyck1 balto:nyck2 lang stomp low pad", dyn: 0.7 },
      { s: "A", play: "mel:nyck1 alto:nyck2 lang stomp low pad", dyn: 0.74 },
      { s: "coda", play: "end:nyck1 cend:horn lang stomp.coda low", dyn: 0.7, rit: 0.88 },
    ],
  ],
  rest: [10, 18],
  level: 0.92,
};
