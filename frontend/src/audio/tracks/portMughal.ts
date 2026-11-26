// 《红砂岩的宫廷》：莫卧儿与德干诸苏丹国的宫城与港口（阿格拉、德里、拉合尔，艾哈迈德讷格尔的焦尔……红砂岩的城墙、白大理石的殿）。
// 地方特色第二阶段：北印度宫廷的德鲁帕德（dhrupad）与宫门鼓楼的颜色，地方乐器领奏（复古合成版的衬底只有很轻的合成弦乐长音与大提琴组的萨）。
// 拉格：达尔巴里·卡纳达（萨 = C：降 E、降 A、降 B；“达尔巴里”就是“宫廷的”——相传是宫廷乐师为御前所作的夜间拉格）：
// 一拍以上的降三级与降六级要慢慢地“摇”着奏（andolan，!andolan!：哪件乐器奏都按 engine.ts 的 ANDOLAN 一样慢，萨朗吉与低八度的鲁德拉维纳琴摇在一起），
// 往下摆——达尔巴里的降三、降六是 ati-komal（比一般的降三、降六还低），降三摆向二级、降六摆向五级，从不往上冲过记谱音；
// 快的经过音不摇；下行常走“降三 · 四 · 二 · 萨”（卡纳达的转折），庄重、深沉；
// 塔拉：乔塔拉（Chautal，十二拍：2 + 2 + 2 + 2 + 2 + 2），两小节 6/4 是一轮，每分钟 80 拍。
// - 鼓楼（naubat）：宫门上的谢赫奈吹一句，纳卡拉锅鼓大小两面滚奏，旁边一支“苏尔”（持续音的谢赫奈，同奥图）吹着萨与帕——君主在城中；
// - 阿拉普：只有鲁德拉维纳琴与坦布拉，低音区一个音一个音地“摸”出拉格，滑音与 andolan；
// - 角德（jod）：维纳琴有了脉动，旋律音与高处的齐卡里弦交替；
// - 斯塔伊（主句）：萨朗吉像歌者一样唱，维纳琴低八度跟着（异音），帕卡瓦吉进来打乔塔拉（Dha Dha | Din Ta | Kit Dha | Din Ta | Tita Kata | Gadi Gana）；
// - 安塔拉：到高音区的萨（第二遍拉巴卜领）；
// - 拉亚卡里：主句用两倍的速度（dugun）再奏一遍，帕卡瓦吉打快的帕兰；
// - 提哈伊：“降三 四 二 萨”连奏三遍，第三遍的萨正好落在下一轮的第一拍（萨姆）上，锅鼓一声收住。
// 北印度古典音乐没有和声：底下只有坦布拉（鼓楼段是苏尔）的萨与帕；和弦一律写空五度 C5，只给持续音与衬底找音。
import type { TrackDef } from "../score";

/** 一小节的 C5（空五度）重复 n 次。 */
const drone = (n: number) => Array.from({ length: n }, () => "C5").join(" | ");

/** n 个点（打击乐的空格）。 */
const rest = (n: number) => ".".repeat(n);

export const PORT_MUGHAL: TrackDef = {
  id: "port_mughal",
  title: { zh: "红砂岩的宫廷", en: "Court of Red Sandstone" },
  qpm: 80,
  meter: [6, 4],
  key: "C minor",
  voices: {
    rudra: { inst: "rudra_veena", gain: 0.68, pan: -0.12, reverb: 0.3 },
    sarangi: { inst: "sarangi", gain: 0.5, pan: 0.14, reverb: 0.34 },
    rabab: { inst: "seni_rabab", gain: 0.5, pan: 0.2, reverb: 0.26 },
    shehnai: { inst: "shehnai", gain: 0.55, pan: 0.06, reverb: 0.38 },
    // 苏尔：鼓楼里吹持续音的那支谢赫奈（与南方的奥图同一种做法）
    sur: { inst: "ottu", gain: 0.3, pan: -0.06, reverb: 0.4, pattern: { kind: "drone", notes: [48, 55] } },
    tanpura: { inst: "tanpura", gain: 0.32, pan: -0.26, reverb: 0.36, pattern: { kind: "arp", low: 48, steps: "5, . . . 8 . . . 8 . . . 1 . . .", ring: 4 } },
    // 帕卡瓦吉：右面（Ta、Din、Tit）与左面（Ge、Ka）两个声部；Dha = Ta + Ge
    pr: {
      inst: "perc",
      gain: 0.32,
      pan: 0.1,
      reverb: 0.24,
      pattern: {
        theka: { kind: "drum", steps: "n.n.d.n..tn.d.n.tn.n.d.n", hits: { n: ["pakh_ta", 0.68], d: ["pakh_din", 0.66], t: ["pakh_tit", 0.5] } },
        paran: { kind: "drum", steps: "n.ttn.ttd.tnn.ttn.ttd.tn", hits: { n: ["pakh_ta", 0.72], d: ["pakh_din", 0.7], t: ["pakh_tit", 0.54] } },
        tihai: { kind: "drum", steps: `n.....n.ttn..n.ttn..n.ttn${rest(11)}`, hits: { n: ["pakh_ta", 0.72], t: ["pakh_tit", 0.54] } },
      },
    },
    pl: {
      inst: "perc",
      gain: 0.32,
      pan: 0.02,
      reverb: 0.24,
      pattern: {
        theka: { kind: "drum", steps: "G.G.....k.G.......k.G.G.", hits: { G: ["pakh_ge", 0.7], k: ["pakh_ka", 0.5] } },
        paran: { kind: "drum", steps: "G...G.k.G...G...G.k.G.k.", hits: { G: ["pakh_ge", 0.72], k: ["pakh_ka", 0.54] } },
        tihai: { kind: "drum", steps: `G.....G...G..G...G..G...G${rest(11)}`, hits: { G: ["pakh_ge", 0.74] } },
      },
    },
    // 宫门鼓楼的纳卡拉：大鼓（咚）与小鼓（嗒，十六分音符的滚奏）
    nd: {
      inst: "perc",
      gain: 0.42,
      pan: -0.1,
      reverb: 0.42,
      pattern: {
        naubat: { kind: "drum", steps: "D.....D.....D...D...D.D.", hits: { D: ["naq_dhum", 0.72] } },
        tihai: { kind: "drum", steps: `${rest(24)}D${rest(11)}`, hits: { D: ["naq_dhum", 0.72] } },
      },
    },
    nt: {
      inst: "perc",
      gain: 0.32,
      pan: 0.18,
      reverb: 0.42,
      pattern: { kind: "drum", steps: "..t.t.tt..t.t.tt..tttttt..t.t.tt..tttttttttttt..", grid: 0.5, hits: { t: ["naq_tak", 0.55] } },
    },
    // 衬底（合成）：很轻的弦乐长音（C–G），大提琴组的低音萨
    pad: { inst: "strings", gain: 0.14, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 55, high: 72, size: 2 } },
    low: { inst: "celli", gain: 0.13, pan: 0.12, reverb: 0.3, pattern: { kind: "arp", low: 36, steps: "1 . . . . . . . . . . .", ring: 12 } },
  },
  sections: {
    // 鼓楼：谢赫奈一句——五 · 高萨 · 低七 高萨 | 高二 摇着的降三 四 二 高萨
    naubat: { bars: 2, chords: drone(2), lines: { call: "z2 G2 !bend!c4 B2 c2 | d2 !andolan!e2 f2 d2 c4" } },
    // 阿拉普：萨 — 低七 萨，二 摇着的降三 — 四 二，萨 低五 摇着的降六 低七，萨
    alap: { bars: 4, chords: drone(4), lines: { call: "C,6 B,,2 !bend!C,4 | D,2 !andolan!E,6 F,2 D,2 | C,4 G,,2 !andolan!A,,4 B,,2 | !bend!C,8 z4" } },
    // 角德：旋律音与高处的齐卡里（C4）交替（八分音符的经过音不摇）
    jod: { bars: 2, chords: drone(2), lines: { jod: "C, C D, C E, C F, C D, C C, C | G,, C A,, C B,, C C, C D, C C,2" } },
    // 斯塔伊：萨 二 摇着的降三 — 四 二 | 萨 低七 摇着的降六 — 低七 低五 | 低四 低五 摇着的降六 低七 萨 — | 降三 四 二 萨——
    sthayi: { bars: 4, chords: drone(4), lines: { st: "(C2 D2) !andolan!E4 (F2 D2) | (C2 B,2) !andolan!A,4 (B,2 G,2) | (F,2 G,2) !andolan!A,2 (B,2 C4) | !andolan!E2 (F2 D2) C6" } },
    // 安塔拉：四 五 摇着的降六 降七 高萨 — | 高萨 高二 摇着的高降三 — 高二 高萨 | 降七 高萨 摇着的降六 — 降七 五 | 降三 — 四 二 萨 —
    antara: { bars: 4, chords: drone(4), lines: { an: "(F2 G2) !andolan!A2 (B2 c4) | (c2 d2) !andolan!e4 (d2 c2) | (B2 c2) !andolan!A4 (B2 G2) | !andolan!E4 (F2 D2) C4" } },
    // 拉亚卡里：斯塔伊用两倍的速度（一拍的降三、降六照样摇，八分音符的不摇）
    laya: { bars: 2, chords: drone(2), lines: { dg: "C D !andolan!E2 F D C B, !andolan!A,2 B, G, | F, G, A, B, C2 E F D C3" } },
    // 提哈伊：降三 四 二 萨，三遍，第三遍的萨落在萨姆上
    tihai: { bars: 3, chords: drone(3), lines: { ti: "G,4 B,2 !andolan!E2 F D C z | z !andolan!E2 F D C z2 !andolan!E2 F D | C12" } },
  },
  forms: [
    [
      { s: "naubat", play: "call:shehnai sur nd.naubat nt", dyn: 0.66 },
      { s: "alap", play: "call:rudra tanpura", dyn: 0.6 },
      { s: "jod", play: "jod:rudra tanpura low", dyn: 0.64 },
      { s: "sthayi", play: "st:sarangi st:rudra-12 tanpura pr.theka pl.theka low", dyn: 0.66 },
      { s: "antara", play: "an:sarangi an:rudra-12 tanpura pr.theka pl.theka low pad", dyn: 0.68 },
      { s: "laya", play: "dg:rudra-12 tanpura pr.paran pl.paran low", dyn: 0.72 },
      { s: "tihai", play: "ti:sarangi ti:rudra-12 tanpura pr.tihai pl.tihai nd.tihai low", dyn: 0.74, rit: 0.94 },
    ],
    [
      { s: "naubat", play: "call:shehnai sur nd.naubat nt", dyn: 0.66 },
      { s: "sthayi", play: "st:rabab st:rudra-12 tanpura pr.theka pl.theka low", dyn: 0.66 },
      { s: "antara", play: "an:sarangi tanpura pr.theka pl.theka low pad", dyn: 0.68 },
      { s: "laya", play: "dg:rabab tanpura pr.paran pl.paran low", dyn: 0.72 },
      { s: "tihai", play: "ti:shehnai+12 ti:rabab-12 sur pr.tihai pl.tihai nd.tihai low", dyn: 0.74, rit: 0.94 },
    ],
  ],
  rest: [10, 18],
  level: 1.3,
};
