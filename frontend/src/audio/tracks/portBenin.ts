// 《胡椒与铜手镯》：贝宁湾的港口（贝宁王国的瓜托：贝宁河口的码头，往内陆一天的路就是贝宁城的王宫——
// 葡萄牙人运来铜手镯（马尼拉），换走胡椒、象牙、棉布与珊瑚珠，王宫的工匠把铜熔了铸成廊柱上的铜牌）。
// 地方特色第二阶段·非洲（评审后改）：瓜托原来借的是曼丁的《鼓语与金沙》，乐器的产地离贝宁湾两千公里；
// 这一首全换成贝宁湾的埃多与约鲁巴的乐器——铜牌上铸着的宫廷乐师就是这几样：象牙号、铁双铃、说话鼓、珠网沙铃。
// 复古合成版的衬底用合成的大提琴组与持续音。旋律原创。
// D 上的五声（D E G A C，没有三度——不写西洋的三和弦），12/8 拍（每分钟 120 个四分音符，附点四分音符 80，宫廷行进的步子）：
// 埃戈戈铁双铃一直敲五下型（x · x · x · · x · x · ·，与刚果的七下标准型不同），古杜古杜小锅鼓打短的固定型，
// 珠网沙铃（埃多人叫 ukuse，就是谢凯雷）落在附点四分音符上；“地方”只在 D 与低一个全音的 C 之间来回摆（西非常见的两“地方”摆动）。
// - 引子：三支象牙号（埃多人叫 akohen，与刚果的姆蓬吉同一类，借同一件乐器）按音高分工——一支吹 D（与低八度的 D），
//   一支只吹 C，一支只吹低处的 A——合起来才是国王的号声；伊亚伊卢（说话鼓的母鼓）接着“念”国王的名号；
// - A：阿克帕塔（埃多说书人的弓琴）一张两手拨一圈两小节的音型，另一张唱说书人的句子——重复的音、一级级落下来，像照着声调说话；
// - B：一领众和——阿克帕塔“领”两小节，三支象牙号“和”两小节（还是一支号一两个音），甘甘在号声的长音里插话；
// - C：“鼓语”——母鼓问一小节、甘甘答一小节，阿克帕塔只拨低音留出空，铁铃不停；
// - A″：说书人的句子再来，号在句尾应一声，母鼓加进来；尾声号声收住。
import type { TrackDef } from "../score";
import { byPitch } from "./weave";

/** 一小节的格子重复 n 遍（小节线分开）。 */
const rep = (bar: string, n: number) => Array.from({ length: n }, () => bar).join(" | ");

/** 阿克帕塔的音型（两小节）：低音落在附点四分音符上，两手的手指交替填在中间；D 与 C 两个“地方”。 */
const OST = "D, A, D C A, D D, A, E D A, C | C, G, C D G, C C, G, E C G, D";
/** 象牙号的句子（几支号按音高分工）。 */
const FANFARE = "!bend!D6 C3 A,3 | !bend!C6 A,3 C3 | !bend!D6 !fall!D,6 | z12";
const RESPONSE = "z12 | z12 | !bend!D6 C3 A,3 | C3 A,3 !fall!D,6 | z12 | z12 | !bend!D6 C3 D3 | C3 A,3 !fall!D,6";
const PUNCT = "z12 | z12 | z12 | z6 !bend!C3 A,3 | z12 | z12 | z12 | z6 !fall!D,6";
const ENDING = "!bend!D6 C3 A,3 | !fall!D,12";
/** 三支号各自的音：一支 D（与低八度的 D），一支 C，一支低处的 A。 */
const H1 = ["D", "D,"] as const;
const H2 = ["C"] as const;
const H3 = ["A,"] as const;
/** 两个“地方”：D 与 C。 */
const AREAS = (bars: number) => rep("D5 | C5", bars / 2);
const ROOTS = (bars: number) => rep("D,,12 | C,,12", bars / 2);

export const PORT_BENIN: TrackDef = {
  id: "port_benin",
  title: { zh: "胡椒与铜手镯", en: "Pepper and Brass Manillas" },
  qpm: 120,
  meter: [12, 8],
  key: "D mixolydian",
  voices: {
    akpata: { inst: "akpata", gain: 0.36, pan: -0.2, reverb: 0.26 },
    akpata2: { inst: "akpata", gain: 0.56, pan: 0.14, reverb: 0.28 },
    horn1: { inst: "mpungi", gain: 0.36, pan: -0.3, reverb: 0.44 },
    horn2: { inst: "mpungi", gain: 0.34, pan: 0.04, reverb: 0.44 },
    horn3: { inst: "mpungi", gain: 0.34, pan: 0.32, reverb: 0.44 },
    iya: {
      inst: "perc",
      gain: 0.34,
      pan: 0.08,
      reverb: 0.3,
      pattern: {
        intro: {
          kind: "drum",
          steps: "..............................l.lU..h.hD..m.lUhD",
          hits: { l: ["iya_lo", 0.7], h: ["iya_hi", 0.7], U: ["iya_up", 0.85], D: ["iya_down", 0.85], m: ["iya_mid", 0.6] },
        },
        a: { kind: "drum", steps: "..........................................l.lUhD", hits: { l: ["iya_lo", 0.55], h: ["iya_hi", 0.55], U: ["iya_up", 0.65], D: ["iya_down", 0.65] } },
        c: {
          kind: "drum",
          steps: "l.lU..h.hhD.............h.hU..l.lUhD............",
          hits: { l: ["iya_lo", 0.75], h: ["iya_hi", 0.75], U: ["iya_up", 0.9], D: ["iya_down", 0.9] },
        },
        coda: { kind: "drum", steps: "......h.hU..D...........", hits: { h: ["iya_hi", 0.7], U: ["iya_up", 0.85], D: ["iya_down", 0.9] } },
      },
    },
    gangan: {
      inst: "perc",
      gain: 0.28,
      pan: -0.28,
      reverb: 0.3,
      pattern: {
        b: { kind: "drum", steps: "..................h.hU.D....................l.lD", hits: { l: ["gangan_lo", 0.55], h: ["gangan_hi", 0.55], U: ["gangan_up", 0.65], D: ["gangan_down", 0.65] } },
        c: {
          kind: "drum",
          steps: "............h.hD..l.lU..............l.lU..h.hD.D",
          hits: { l: ["gangan_lo", 0.7], h: ["gangan_hi", 0.7], U: ["gangan_up", 0.85], D: ["gangan_down", 0.85] },
        },
      },
    },
    bell: {
      inst: "perc",
      gain: 0.2,
      pan: 0.36,
      reverb: 0.28,
      pattern: {
        a: { kind: "drum", steps: "L.h.h..L.h..", hits: { L: ["egogo_lo", 0.65], h: ["egogo_hi", 0.5] } },
        coda: { kind: "drum", steps: "L.h.h..L....L...........", hits: { L: ["egogo_lo", 0.7], h: ["egogo_hi", 0.55] } },
      },
    },
    gudu: {
      inst: "perc",
      gain: 0.3,
      pan: -0.1,
      reverb: 0.24,
      pattern: {
        a: { kind: "drum", steps: "D.kk.kD..k.k", hits: { D: ["gudugudu_lo", 0.6], k: ["gudugudu_hi", 0.45] } },
        c: { kind: "drum", steps: "D.....D..k..", hits: { D: ["gudugudu_lo", 0.55], k: ["gudugudu_hi", 0.4] } },
        coda: { kind: "drum", steps: "D.kk.kD.....D...........", hits: { D: ["gudugudu_lo", 0.7], k: ["gudugudu_hi", 0.5] } },
      },
    },
    ukuse: { inst: "perc", gain: 0.2, pan: -0.36, reverb: 0.24, pattern: { kind: "drum", steps: "S..S.sS..S.s", hits: { S: ["shekere", 0.5], s: ["shekere_soft", 0.35] } } },
    // 衬底（合成）：大提琴组拉根音的长音，空五度的持续音跟着 D 与 C 两个“地方”走
    low: { inst: "celli", gain: 0.2, pan: 0.12, reverb: 0.26 },
    pad: { inst: "drone", gain: 0.15, pan: -0.18, reverb: 0.42, pattern: { kind: "pad", low: 48, high: 64, size: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "D5 | C5 | D5 | D5",
      lines: {
        f1: byPitch(FANFARE, H1),
        f2: byPitch(FANFARE, H2),
        f3: byPitch(FANFARE, H3),
        kin: `z12 | z12 | z12 | ${OST.split(" | ")[0]}`,
        root: "D,,12 | C,,12 | D,,12 | D,,12",
      },
    },
    A: {
      bars: 8,
      chords: AREAS(8),
      lines: {
        ost: rep(OST, 4),
        // 说书人的句子：重复的音、一级级落下来
        mel: "A2 A G2 E D2 E G3 | A3 c2 A G2 E D3 | c2 c A2 G A2 c d3 | c2 A G2 E D6 | d2 d c2 A c2 d e3 | d3 c2 A G2 A c3 | A2 G E2 D E2 G A3 | G2 E D2 C D6",
        p1: byPitch(PUNCT, H1),
        p2: byPitch(PUNCT, H2),
        p3: byPitch(PUNCT, H3),
        root: ROOTS(8),
      },
    },
    B: {
      bars: 8,
      chords: AREAS(8),
      lines: {
        // 一领：阿克帕塔
        call: "d2 d c2 A c3 A3 | G2 A c2 A G6 | z12 | z12 | e2 e d2 c d3 c3 | A2 c d2 c A6 | z12 | z12",
        // 众和：三支象牙号
        r1: byPitch(RESPONSE, H1),
        r2: byPitch(RESPONSE, H2),
        r3: byPitch(RESPONSE, H3),
        ost: rep(OST, 4),
        root: ROOTS(8),
      },
    },
    C: {
      bars: 4,
      chords: AREAS(4),
      lines: {
        // 阿克帕塔只拨低音，让出“鼓语”的空
        kbass: "D,3 z3 A,3 z3 | C,3 z3 G,3 z3 | D,3 z3 A,3 z3 | C,3 z3 G,3 z3",
        root: ROOTS(4),
      },
    },
    coda: {
      bars: 2,
      chords: "D5 | D5",
      lines: {
        e1: byPitch(ENDING, H1),
        e2: byPitch(ENDING, H2),
        e3: byPitch(ENDING, H3),
        kend: "D, A, D C A, D D,6 | z12",
        root: "D,,12 | D,,12",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "f1:horn1 f2:horn2 f3:horn3 kin:akpata iya.intro root:low pad", dyn: 0.6, to: 0.66 },
      { s: "A", play: "ost:akpata mel:akpata2 bell.a ukuse gudu.a root:low pad", dyn: 0.66 },
      { s: "B", play: "call:akpata2 r1:horn1 r2:horn2 r3:horn3 ost:akpata bell.a ukuse gudu.a gangan.b root:low pad", dyn: 0.7 },
      { s: "C", play: "kbass:akpata iya.c gangan.c gudu.c bell.a root:low pad", dyn: 0.68 },
      { s: "A", play: "ost:akpata mel:akpata2 p1:horn1 p2:horn2 p3:horn3 bell.a ukuse gudu.a iya.a root:low pad", dyn: 0.74 },
      { s: "coda", play: "e1:horn1 e2:horn2 e3:horn3 kend:akpata iya.coda bell.coda gudu.coda root:low", dyn: 0.72, rit: 0.9 },
    ],
    [
      { s: "A", play: "ost:akpata mel:akpata2 bell.a ukuse gudu.a root:low pad", dyn: 0.64 },
      { s: "C", play: "kbass:akpata iya.c gangan.c gudu.c bell.a root:low pad", dyn: 0.66 },
      { s: "B", play: "call:akpata2 r1:horn1 r2:horn2 r3:horn3 ost:akpata bell.a ukuse gudu.a gangan.b root:low pad", dyn: 0.7 },
      { s: "coda", play: "e1:horn1 e2:horn2 e3:horn3 kend:akpata iya.coda bell.coda gudu.coda root:low", dyn: 0.7, rit: 0.9 },
    ],
  ],
  rest: [10, 18],
  level: 1.36,
};
