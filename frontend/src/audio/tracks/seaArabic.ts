// 《星与三角帆》：阿拉伯的海——红海、亚丁湾、阿拉伯海与波斯湾（吉达、摩卡、亚丁、马斯喀特、霍尔木兹、尤尔法之间三角帆船的海路，
// 领航人看着星走）。寰宇里这几片海的 music 写 arabic；原来借黎凡特的《雪松与珊瑚》，那首由布祖克与爱琴海的里拉琴领奏，
// 在红海与海湾就不对了，所以这几片海有了自己的一首（地方特色第二阶段，审查后新写；旋律原创）。
// 调式：D 上的萨巴（D、E 半降、F、降G、A、降B、C——第四级比巴亚提低半音，听起来像一声叹气；从开罗到巴士拉都认得的调式），
// 曲谱的调号记成 D 巴亚提（E 半降、降B），萨巴的降 G 逐个写出来；B 段把 G 还原，升到巴亚提的高音区（侯赛尼一带），最后两小节沿降 G 落回萨巴。
// 节奏：阿尤布（ayyub，2/4 的“咚 · · 卡 咚 · 嗒 ·”，一小节两轮），像船身一起一伏地往前推；每分钟 104 拍，4/4。
// 地方乐器领奏（复古合成版的衬底用合成的持续音与拨奏低音，管弦版里换成很轻的管弦）：
// - 引子：奈伊笛在 D–A 的持续音上吹一段塔克西姆（按上来、深揉、往下落），乌德琴在空处低低地应两句，不打鼓；
// - A：乌德琴领奏（阿拉伯半岛与海湾最常见的乐器），卡农琴高八度跟着同一条旋律（异音齐奏：长音轮指，第 4、第 8 小节换成一串碎的上下行），
//   达布卡打阿尤布，塔尔框鼓（tar——阿拉伯海两岸同一种框鼓，斯瓦希里海岸叫 tari）跟着“咚”；
// - A（再一遍）：奈伊笛高八度唱同一条旋律（音头按上来、长音深揉、句尾往下落），乌德琴同度跟着，里克鼓加进来；
// - B：克曼切领奏高音区的句子（回旋音、倚音、圆滑，句尾往下落），乌德琴低八度、卡农琴同度跟着，鼓加花；
// - 最后一遍 A：乌德琴、奈伊笛、克曼切、卡农琴各奏各的装饰（异音齐奏）；尾声乌德琴收在 D 上。
// 和声不用西洋的和弦：A 段整段只有 D–A 的空五度（萨巴的降 G 与 F 隔半音，配 F、C 的五度会撞），B 段才换 F5、C5、G5。
// 与《雪松与珊瑚》（G 希贾兹、10/8 阿克萨克、布祖克与里拉琴）、《酒色的海湾》（D 巴亚提与希扎兹、7/8）、
// 经典的《驼铃与海风》（D 希贾兹 6/8）都不同：调式、节奏与领奏乐器都换了。
import type { TrackDef } from "../score";

export const SEA_ARABIC: TrackDef = {
  id: "sea_arabic",
  title: { zh: "星与三角帆", en: "Stars and Lateen Sails" },
  qpm: 104,
  meter: [4, 4],
  key: "D bayati",
  voices: {
    ud: { inst: "ud", gain: 0.56, pan: -0.14, reverb: 0.26 },
    nay: { inst: "nay", gain: 0.48, pan: 0.14, reverb: 0.4 },
    kemence: { inst: "kemence", gain: 0.44, pan: 0.1, reverb: 0.32 },
    // 卡农琴：跟着旋律异音齐奏（不弹分解和弦）
    kanun: { inst: "kanun", gain: 0.3, pan: 0.34, reverb: 0.3 },
    // 达布卡：阿尤布（十六分音符一格，一小节两轮：咚 · · 卡 咚 · 嗒 ·）；soft 不带“卡”，b 在空处加轻的“卡”
    darbuka: {
      inst: "perc",
      gain: 0.26,
      pan: 0.08,
      reverb: 0.22,
      pattern: {
        a: { kind: "drum", grid: 0.5, steps: "D..kD.T.D..kD.T.", hits: { D: ["darb_doum", 0.7], T: ["darb_tek", 0.48], k: ["darb_ka", 0.32] } },
        soft: { kind: "drum", grid: 0.5, steps: "D...D.T.D...D.T.", hits: { D: ["darb_doum", 0.62], T: ["darb_tek", 0.4] } },
        b: { kind: "drum", grid: 0.5, steps: "D..kD.TkD.kkD.Tk", hits: { D: ["darb_doum", 0.72], T: ["darb_tek", 0.5], k: ["darb_ka", 0.3] } },
      },
    },
    // 塔尔框鼓：跟着阿尤布的两个“咚”，“卡”的位置轻拍鼓边
    tari: {
      inst: "perc",
      gain: 0.22,
      pan: -0.18,
      reverb: 0.28,
      pattern: {
        a: { kind: "drum", grid: 0.5, steps: "T...T...T...T...", hits: { T: ["tari", 0.56] } },
        b: { kind: "drum", grid: 0.5, steps: "T..tT...T..tT...", hits: { T: ["tari", 0.6], t: ["tari_tek", 0.32] } },
      },
    },
    riq: { inst: "perc", gain: 0.26, pan: -0.3, reverb: 0.22, pattern: { kind: "drum", grid: 0.5, steps: "R..rR.r.R..rR.r.", hits: { R: ["riq", 0.3], r: ["riq", 0.2] } } },
    // 衬底（合成）：D–A 的持续音（引子与尾声）、空五度的长音、拨奏的低音落在阿尤布的第一个“咚”与半小节上
    drone: { inst: "drone", gain: 0.32, reverb: 0.3, pattern: { kind: "drone", notes: [38, 45] } },
    dem: { inst: "drone", gain: 0.15, pan: -0.22, reverb: 0.4, pattern: { kind: "pad", low: 50, high: 64, size: 2 } },
    bass: { inst: "pizz", gain: 0.3, pan: 0.05, reverb: 0.15, pattern: { kind: "arp", low: 38, steps: "1 . . . 5, . . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "D5 | D5 | D5 | D5",
      lines: {
        // 奈伊笛的塔克西姆（曲式里高八度吹）：萨巴的下四音列，降 G 上停一下再落回 D
        tak: "z2 !bend!F4 E D | !vib!D6 z2 | z2 F _G !bend!A3 _G | F E !fall!D6",
        // 乌德琴在空处低低地应
        call: "z8 | z4 A,2 _G,2 | F,2 E, D, z4 | z4 D,4",
      },
    },
    A: {
      bars: 8,
      chords: "D5 | D5 | D5 | D5 | D5 | D5 | D5 | D5",
      lines: {
        // 乌德琴：从下面的 A 升上来，在降 G 上叹一口气落回 D；后半句升到降 B、C，再沿萨巴落下。几处倚音
        mel: "A,2 D3 E F2 | _G3 F E F E D | D2 A, C D E F2 | {F}E3 F E D3 | F2 _G2 A3 B | {d}c3 B A2 _G2 | A2 _G F E2 F E | D6 z2",
        // 奈伊笛（曲式里高八度吹）：音头按上来、长音深揉、上方的倚音，句尾往下落
        nmel: "!bend!A,2 D3 E F2 | !vib!_G3 F E F E D | D2 A, C D E F2 | {F}E3 F E !fall!D3 | !bend!F2 _G2 !vib!A3 B | {d}c3 B A2 _G2 | A2 _G F E2 F E | !vib!D6 z2",
        // 克曼切（同度）：回旋音、圆滑、倚音，句尾往下落
        kem: "!bend!A,2 D3 E F2 | ~_G3 (F E) F E D | D2 A, C D (E F2) | {F}E3 (F E) !fall!D3 | F2 (_G2 A3) B | {d}c3 (B A2) _G2 | A2 (_G F) ~E2 F E | !vib!D6 z2",
        // 卡农琴（高八度）：同一条旋律，长音用轮指；第 4、第 8 小节的长音换成一串碎的上下行
        kmel: "A2 d3 e f2 | _g3 f e f e d | d2 A c d e f2 | e2 f/2e/2d/2e/2 f/2e/2 d3 | f2 _g2 a3 b | c'3 b a2 _g2 | a2 _g f e2 f e | d2 e/2f/2_g/2f/2 e/2d/2c/2e/2 d2",
      },
    },
    B: {
      bars: 8,
      // 第 1–6 小节是巴亚提的高音区（G 还原），第 7 小节沿降 G 落回萨巴
      chords: "D5 | D5 | F5 | C5 | G5 | C5 | D5 | D5",
      lines: {
        bmel: "d2 e f3 g2 | a3 g f2 e2 | f2 g2 a3 b | c'3 b a4 | d'3 c' b2 a2 | g3 f e2 f2 | _g3 f e2 d2 | d6 z2",
        // 克曼切：同一句，回旋音、倚音、圆滑，句尾往下落
        bkem: "!bend!d2 e f3 ~g2 | (a3 g) f2 {g}e2 | f2 (g2 a3) b | {d'}c'3 (b a4) | !vib!d'3 c' (b2 a2) | {a}g3 (f e2) f2 | ~_g3 (f e2) d2 | !fall!d6 z2",
        // 奈伊笛：同一句，按上来、深揉、句尾往下落
        bnay: "!bend!d2 e f3 g2 | !vib!a3 g f2 e2 | f2 g2 !vib!a3 b | {d'}c'3 b !vib!a4 | d'3 c' b2 a2 | g3 f e2 f2 | {a}_g3 f e2 d2 | !fall!d6 z2",
        // 卡农琴（同度）：同一句，第 4、第 8 小节各一串碎的上下行
        kbmel: "d2 e f3 g2 | a3 g f2 e2 | f2 g2 a3 b | c'3 b a/2b/2a/2g/2 a2 | d'3 c' b2 a2 | g3 f e2 f2 | _g3 f e2 d2 | d2 e/2f/2e/2d/2 c/2d/2e/2c/2 d2",
      },
    },
    outro: { bars: 2, chords: "D5 | D5", lines: { tag: "A,2 D E F _G F E | D8" } },
  },
  forms: [
    [
      { s: "intro", play: "tak:nay+12 call:ud drone", dyn: 0.55, to: 0.62 },
      { s: "A", play: "mel:ud kmel:kanun dem bass darbuka.soft tari", dyn: 0.64 },
      { s: "A", play: "nmel:nay+12 mel:ud kmel:kanun dem bass darbuka riq tari", dyn: 0.67 },
      { s: "B", play: "bkem:kemence bmel:ud-12 kbmel:kanun dem bass darbuka.b riq tari.b", dyn: 0.7, to: 0.73 },
      { s: "A", play: "mel:ud nmel:nay+12 kem:kemence kmel:kanun dem bass darbuka riq tari", dyn: 0.71 },
      { s: "outro", play: "tag:ud drone bass", dyn: 0.6, to: 0.4, rit: 0.85 },
    ],
    [
      { s: "intro", play: "tak:nay+12 drone", dyn: 0.52, to: 0.6 },
      { s: "A", play: "nmel:nay+12 kmel:kanun dem bass darbuka.soft tari", dyn: 0.62 },
      { s: "B", play: "bnay:nay bmel:ud-12 kbmel:kanun dem bass darbuka riq tari", dyn: 0.66 },
      { s: "B", play: "bkem:kemence bmel:ud-12 kbmel:kanun dem bass darbuka.b riq tari.b", dyn: 0.7, to: 0.73 },
      { s: "A", play: "mel:ud nmel:nay+12 kem:kemence kmel:kanun dem bass darbuka riq tari", dyn: 0.71 },
      { s: "outro", play: "tag:nay+12 drone bass", dyn: 0.58, to: 0.38, rit: 0.85 },
    ],
  ],
  rest: [25, 45],
  level: 1.08,
};
