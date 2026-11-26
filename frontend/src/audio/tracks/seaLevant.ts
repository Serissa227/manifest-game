// 《雪松与珊瑚》：奥斯曼与阿拉伯的海岸（黎凡特的雪松港口——的黎波里、西顿、亚历山大——与红海的珊瑚礁、吉达、亚丁）。
// 地方特色第二阶段审查后：布祖克与爱琴海的里拉琴领奏的这一版只管黎凡特海、爱琴海、黑海与马尔马拉海（music 写 levant、ottoman）；
// 红海、亚丁湾、阿拉伯海与波斯湾（music 写 arabic、red_sea）改放乌德琴、奈伊笛、克曼切领奏的《星与三角帆》（seaArabic.ts）。
// G 上的希贾兹（降 A 与还原 B 之间的增二度；十二平均律里的近似，不用四分之一音），10/8 拍的阿克萨克（3 + 2 + 2 + 3：
// 咚 · · 嗒 · 咚 · 嗒 · ·，“瘸着腿”的拍子），每分钟 116 拍。A 段的旋律与段落沿用第二轮（开头奈伊笛吹起全作的起帆动机 D → G → D）。
// 地方特色第二阶段重编：地方乐器领奏（复古合成版的衬底用合成的持续音与拨奏低音）——
// - 引子：奈伊笛吹起帆动机，G–D 的持续音，达布卡打阿克萨克；
// - A：布祖克琴领奏（黎凡特港口的长颈琉特，钢丝弦、拨片贴着琴桥，长音用震音），卡农琴高八度跟着同一条旋律（异音齐奏：
//   长音用轮指，句尾——第 4 与第 8 小节——各留一串碎的上下行）；再来一遍时奈伊笛唱（音头按上来、长音深揉、句尾往下落），乌德琴低八度跟着；
// - B：转到 C 一侧的纳哈万德（C D 降E F G 降A 还原B——希贾兹正是它的上半截），按级进落到 C 上，再沿 C 降A 的增二度回到 G 希贾兹；
//   爱琴海的里拉琴唱（倚音、回旋音、圆滑、句尾往下落），布祖克低八度跟着，卡农琴同度异音，本迪尔框鼓与里克鼓加进来；
// - 最后一遍 A：布祖克、奈伊笛、里拉琴、卡农琴各奏各的装饰（异音齐奏）；尾声布祖克收在 G 上。
// 每件领奏乐器各有一行带装饰的同一条旋律（mel 是布祖克与乌德琴的，nmel 奈伊笛、lmel 里拉琴、kmel 卡农琴；B 段同理）。
// 和声改成空五度（G5、C5、F5），去掉了原来的西洋三和弦进行（降 A 大、C 小、F 小、降 B 大）；
// B 段原来跟着三和弦写的分解和弦（降 B 大、降 A 大、G 大依次下行）也改写成级进的木卡姆句子。
// 与经典世界的《驼铃与海风》（D 希贾兹 6/8）、港口曲《香料之路》（巴亚提、四分之一音）不同：主音、拍子与配器都换了。
import type { TrackDef } from "../score";

export const SEA_LEVANT: TrackDef = {
  id: "sea_levant",
  title: { zh: "雪松与珊瑚", en: "Cedar and Coral" },
  qpm: 116,
  meter: [10, 8],
  key: "G hijaz",
  voices: {
    buzuq: { inst: "buzuq", gain: 0.58, pan: -0.16, reverb: 0.28 },
    nay: { inst: "nay", gain: 0.5, pan: 0.16, reverb: 0.4 },
    lyra: { inst: "lyra", gain: 0.46, pan: 0.12, reverb: 0.32 },
    ud: { inst: "ud", gain: 0.5, pan: -0.06, reverb: 0.26 },
    // 卡农琴：跟着旋律异音齐奏（不弹西式的分解和弦）
    kanun: { inst: "kanun", gain: 0.3, pan: 0.34, reverb: 0.3 },
    darbuka: {
      inst: "perc",
      gain: 0.26,
      pan: 0.1,
      reverb: 0.22,
      pattern: {
        a: { kind: "drum", steps: "D..T.D.T..", hits: { D: ["darb_doum", 0.72], T: ["darb_tek", 0.48] } },
        b: { kind: "drum", steps: "D.kT.DkTkk", hits: { D: ["darb_doum", 0.74], T: ["darb_tek", 0.5], k: ["darb_ka", 0.32] } },
      },
    },
    riq: { inst: "perc", gain: 0.3, pan: -0.3, reverb: 0.22, pattern: { kind: "drum", steps: ".rr.r.r.rr", hits: { r: ["riq", 0.28] } } },
    bendir: { inst: "perc", gain: 0.24, pan: -0.14, reverb: 0.3, pattern: { kind: "drum", steps: "B..b.B.b..", hits: { B: ["bendir", 0.6], b: ["bendir_tek", 0.4] } } },
    // 衬底（合成）：G–D 的持续音（引子与尾声）、空五度的长音、拨奏的低音按阿克萨克走
    drone: { inst: "drone", gain: 0.34, reverb: 0.28, pattern: { kind: "drone", notes: [43, 50] } },
    dem: { inst: "drone", gain: 0.16, pan: -0.22, reverb: 0.4, pattern: { kind: "pad", low: 48, high: 64, size: 2 } },
    bass: { inst: "pizz", gain: 0.32, pan: 0.05, reverb: 0.15, pattern: { kind: "arp", low: 36, steps: "1 . . 5, . 1 . 5, . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "G5 | G5",
      // 起帆动机（D → G → D）
      lines: { motif: "z6 D3/2 G/2 z2 | d8 z2" },
    },
    A: {
      bars: 8,
      chords: "G5 | G5 | C5 | G5 | C5 | F5 | C5 | G5",
      lines: {
        // 布祖克（乌德琴低八度同奏）：几处倚音，长音自己用拨片的震音
        mel: "G3 A2 B2 c3 | d3 c2 B2 {B}A3 | c3 B2 A2 G3 | B5 A2 G3 | c3 d2 e2 {e}d3 | c3 B2 A2 F3 | e3 d2 c2 {c}B3 | B3 A2 G5",
        // 奈伊笛：音头从下面按上来、长音深揉、上方的倚音，句尾往下落
        nmel: "!bend!G3 A2 B2 c3 | !vib!d3 c2 B2 A3 | {d}c3 B2 A2 G3 | !vib!B5 A2 G3 | c3 d2 e2 d3 | {d}c3 B2 A2 !vib!F3 | !bend!e3 d2 c2 B3 | B3 A2 !fall!G5",
        // 里拉琴：倚音、回旋音、圆滑，句尾往下落
        lmel: "!bend!G3 A2 B2 c3 | (d3 c2) B2 {B}A3 | {d}c3 (B2 A2) G3 | ~B5 A2 G3 | c3 (d2 e2) d3 | {d}c3 (B2 A2) F3 | e3 (d2 c2) {c}B3 | ~B3 A2 !fall!G5",
        // 卡农琴（高八度）：同一条旋律，长音用轮指；第 4、第 8 小节的长音换成一串碎的上下行
        kmel: "g3 a2 b2 c'3 | d'3 c'2 b2 a3 | c'3 b2 a2 g3 | b2 c'/2b/2a/2b/2 c'/2b/2 a2 g3 | c'3 d'2 e'2 d'3 | c'3 b2 a2 f3 | e'3 d'2 c'2 b3 | b3 a2 g/2a/2b/2c'/2 d'/2c'/2b/2a/2 g",
      },
    },
    B: {
      bars: 8,
      // 第 1–4 小节在 C 一侧（纳哈万德），第 5 小节沿增二度回到 G，第 6–8 小节是 G 希贾兹的上行与落下
      chords: "C5 | C5 | F5 | C5 | C5 | G5 | F5 | G5",
      lines: {
        bmel: "g3 g2 f2 e3 | d3 e f d2 c3 | f3 g2 f2 e3 | d3 c2 B2 c3 | {d}c3 B2 A2 G3 | {A}G3 B2 c2 d3 | e3 d2 c B A3 | G6 z4",
        // 里拉琴：同一句，倚音、回旋音、圆滑，句尾往下落
        blyr: "!bend!g3 g2 f2 ~e3 | (d3 e f) d2 c3 | {g}f3 g2 (f2 e3) | d3 c2 {c}B2 !vib!c3 | {d}c3 (B2 A2) G3 | {A}G3 B2 c2 ~d3 | e3 (d2 c B) A3 | !fall!G6 z4",
        // 卡农琴（同度）：同一句，第 4 小节落到 C 时、第 8 小节落到 G 时各一串碎的上下行
        kbmel: "g3 g2 f2 e3 | d3 e f d2 c3 | f3 g2 f2 e3 | d3 c2 B2 c/2d/2e/2d/2 c | c3 B2 A2 G3 | G2 A B2 c2 d3 | e3 d2 c B A3 | G4 g/2f/2e/2d/2 c/2B/2A/2B/2 G2",
      },
    },
    outro: { bars: 2, chords: "F5 | G5", lines: { tag: "A3 c2 B2 A3 | G10" } },
  },
  forms: [
    [
      { s: "intro", play: "motif:nay drone darbuka", dyn: 0.55, to: 0.64 },
      { s: "A", play: "mel:buzuq kmel:kanun dem bass darbuka", dyn: 0.66 },
      { s: "A", play: "nmel:nay mel:ud-12 kmel:kanun dem bass darbuka riq", dyn: 0.68 },
      { s: "B", play: "blyr:lyra bmel:buzuq-12 kbmel:kanun dem bass darbuka.b riq bendir", dyn: 0.7, to: 0.74 },
      { s: "A", play: "mel:buzuq nmel:nay lmel:lyra kmel:kanun dem bass darbuka riq", dyn: 0.72 },
      { s: "outro", play: "tag:buzuq drone bass", dyn: 0.6, to: 0.4, rit: 0.85 },
    ],
    [
      { s: "intro", play: "motif:nay drone", dyn: 0.52, to: 0.6 },
      { s: "A", play: "nmel:nay kmel:kanun dem bass darbuka", dyn: 0.64 },
      { s: "B", play: "bmel:buzuq kbmel:kanun dem bass darbuka riq", dyn: 0.68 },
      { s: "B", play: "blyr:lyra bmel:ud-12 kbmel:kanun dem bass darbuka.b riq bendir", dyn: 0.72, to: 0.74 },
      { s: "A", play: "mel:buzuq nmel:nay lmel:lyra kmel:kanun dem bass darbuka riq", dyn: 0.72 },
      { s: "outro", play: "tag:nay drone bass", dyn: 0.58, to: 0.38, rit: 0.85 },
    ],
  ],
  rest: [25, 45],
  level: 1,
};
