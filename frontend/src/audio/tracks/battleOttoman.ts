// 《新月的战鼓》：海战的奥斯曼变奏——敌人是奥斯曼的舰队（或奉奥斯曼旗号的巴巴里海盗）时代替《黑帆》，见 zones.ts 的 battleTrackOf。
// 写成梅赫特（奥斯曼的军乐队）的样子：地方乐器领奏，复古合成版的衬底只有合成的持续音与拨奏低音。
// D 上的希贾兹（D 降E 升F G A 降B C：降 E 与升 F 之间的增二度），8/8 的杜耶克乌苏尔（咚 嗒 · 嗒 咚 · 嗒 ·，击点在第 1、2、4、5、7 个八分音符；
// 与阿拉伯的马克苏姆同型，记成 4/4 的一小节），每分钟 132 拍，奏完不留白，直接从头再来：
// - 引子：克斯大鼓两声“轰”，博鲁号吹号令（只用 D 号泛音列上的 A4 D5 升F5 A5）；
// - 哈内一：祖尔纳高声领、低八度的卡巴祖尔纳同奏（军乐里成排的祖尔纳），纳卡雷小锅鼓一刻不停地催，达乌尔打杜耶克，
//   克斯大鼓每小节一声，齐尔大钹在句头“锵”，杰夫根响杖在拍上“哗啷”；博鲁在句尾应一声；
// - 泰斯利姆（叠句）：全体齐奏，博鲁给旋律打骨架，克斯两声一小节；
// - “交锋”：旋律停下，卡巴祖尔纳持着主音 D，克斯与纳卡雷一来一往、越打越密，博鲁一遍遍吹号令；
// - 哈内二：祖尔纳爬到高处，一路沿希贾兹音阶落回主音，再回到泰斯利姆。
// 和声不用西洋的和弦进行：只有空五度（D5、C5、G5），像军乐里成排祖尔纳底下的“dem”。旋律原创。
import type { TrackDef } from "../score";

export const BATTLE_OTTOMAN: TrackDef = {
  id: "battle_ottoman",
  title: { zh: "新月的战鼓", en: "War Drums of the Crescent" },
  qpm: 132,
  meter: [4, 4],
  key: "D hijaz",
  voices: {
    zurna: { inst: "zurna", gain: 0.42, pan: -0.1, reverb: 0.3 },
    // 卡巴祖尔纳（低八度）
    kaba: { inst: "zurna", gain: 0.36, pan: 0.14, reverb: 0.3 },
    boru: { inst: "boru", gain: 0.4, pan: 0.24, reverb: 0.36 },
    kos: {
      inst: "perc",
      gain: 0.3,
      pan: 0,
      reverb: 0.34,
      pattern: {
        intro: { kind: "drum", steps: "K.......K...k.K.", hits: { K: ["kos", 0.95], k: ["kos_hi", 0.8] } },
        a: { kind: "drum", steps: "K.......k.......", hits: { K: ["kos", 0.85], k: ["kos_hi", 0.7] } },
        t: { kind: "drum", steps: "K...k...", hits: { K: ["kos", 0.9], k: ["kos_hi", 0.75] } },
        ceng: { kind: "drum", steps: "K....... k...K... K.k.K.k. KkKkK...", hits: { K: ["kos", 0.95], k: ["kos_hi", 0.8] } },
      },
    },
    nakkare: {
      inst: "perc",
      gain: 0.32,
      pan: -0.22,
      reverb: 0.24,
      pattern: {
        a: { kind: "drum", grid: 0.5, steps: "H.l.H.l.H.l.HlHl", hits: { H: ["nakkare_hi", 0.62], l: ["nakkare_lo", 0.5] } },
        t: { kind: "drum", grid: 0.5, steps: "HlHlH.l.HlHlH.l.", hits: { H: ["nakkare_hi", 0.7], l: ["nakkare_lo", 0.56] } },
        ceng: {
          kind: "drum",
          grid: 0.5,
          // 一来一往：克斯“轰”的那一拍纳卡雷不打，后面一串滚奏接上，越来越密
          steps: "........HlHlH.l. ........HlHlHlHl ....HlHl....HlHl HlHlHlHlHlHlHlHl",
          hits: { H: ["nakkare_hi", 0.72], l: ["nakkare_lo", 0.6] },
        },
      },
    },
    davul: {
      inst: "perc",
      gain: 0.3,
      pan: 0.08,
      reverb: 0.26,
      pattern: {
        // 杜耶克的骨架：咚（大槌）嗒（细棍）· 嗒 咚 · 嗒 ·
        a: { kind: "drum", steps: "Dt.tD.t.", hits: { D: ["davul_dum", 0.72], t: ["davul_tek", 0.55] } },
        // 泰斯利姆在同一副骨架上加花：细棍在两个空处轻轻补一下（第 3 个与最后一个八分音符，后一下带进下一小节）
        t: { kind: "drum", steps: "DtktD.tk", hits: { D: ["davul_dum", 0.8], t: ["davul_tek", 0.6], k: ["davul_tek", 0.38] } },
        ceng: { kind: "drum", steps: "D...t...D...t...D.t.D.t.DtDtDDD.", hits: { D: ["davul_dum", 0.8], t: ["davul_tek", 0.6] } },
      },
    },
    zil: {
      inst: "perc",
      gain: 0.16,
      pan: 0.3,
      reverb: 0.4,
      pattern: {
        a: { kind: "drum", steps: "Z...c.......c...", hits: { Z: ["zil", 0.7], c: ["zil_mute", 0.5] } },
        t: { kind: "drum", steps: "Z...c...", hits: { Z: ["zil", 0.75], c: ["zil_mute", 0.55] } },
        ceng: { kind: "drum", grid: 0.5, steps: "Z.......c....... Z.......c....... Z.......Z....... Z.Z.Z.Z.Z.......", hits: { Z: ["zil", 0.75], c: ["zil_mute", 0.55] } },
      },
    },
    cevgen: {
      inst: "perc",
      gain: 0.18,
      pan: -0.34,
      reverb: 0.34,
      pattern: {
        a: { kind: "drum", steps: "C...t...C...t.t.", hits: { C: ["cevgen", 0.6], t: ["cevgen_tap", 0.45] } },
        t: { kind: "drum", steps: "C.t.C.t.", hits: { C: ["cevgen", 0.66], t: ["cevgen_tap", 0.5] } },
      },
    },
    // 衬底（合成）：空五度的持续音、拨奏的低音；泰斯利姆里加一层弦乐群，交锋与泰斯利姆里拨奏改成八分音符往前推
    dem: { inst: "drone", gain: 0.16, pan: -0.16, reverb: 0.36, pattern: { kind: "pad", low: 38, high: 57, size: 2 } },
    bass: { inst: "pizz", gain: 0.26, pan: 0.06, reverb: 0.15, pattern: { kind: "arp", low: 38, steps: "1 . . . 1 . . .", ring: 2 } },
    drive: { inst: "pizz", gain: 0.2, pan: 0.1, reverb: 0.14, pattern: { kind: "arp", low: 38, steps: "1 1 1 1 1 1 5, 1" } },
    hbed: { inst: "strings", gain: 0.16, pan: -0.24, reverb: 0.4, pattern: { kind: "pad", low: 50, high: 64, size: 2 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "D5 | D5",
      lines: { call: "z4 A2 d2 | f3 a/2f/2 !fall!d4" },
    },
    hane1: {
      bars: 8,
      chords: "D5 | D5 | D5 | C5 | D5 | G5 | C5 | D5",
      lines: {
        mel: "d3 e/2f/2 g2 g2 | a3 b a g f e | f2 g f e2 d2 | e2 d c d4 | a2 a b c'2 b a | b2 a g a2 g f | g2 f e f2 e d | d6 z2",
        // 博鲁在句尾应一声
        ans: "z8 | z8 | z8 | z4 A2 d2 | z8 | z8 | z8 | z2 A2 d2 f2",
      },
    },
    teslim: {
      bars: 4,
      chords: "G5 | D5 | C5 | D5",
      lines: {
        ref: "g3 g a2 b2 | a3 g f2 e2 | g2 f e d2 c2 | d2 z A d2 z2",
        // 博鲁的骨架（泛音列上的音）
        bone: "d4 d2 d2 | a4 f2 d2 | z4 c'2 a2 | d2 z A d2 z2",
      },
    },
    ceng: {
      bars: 4,
      chords: "D5 | D5 | D5 | D5",
      lines: {
        sig: "a2 z2 a2 z2 | f2 z2 d4 | a2 z2 a2 z2 | f2 a2 !fall!d4",
        // 卡巴祖尔纳持着主音
        hum: "D8 | D8 | D8 | D4 z4",
      },
    },
    hane2: {
      bars: 8,
      chords: "D5 | C5 | G5 | D5 | D5 | C5 | G5 | D5",
      lines: {
        bmel: "a2 a/2b/2a/2g/2 f2 a2 | c'3 b a2 g2 | b2 a g a2 b2 | a6 b c' | d'2 c' b a2 g a | g2 f e f2 g2 | b2 a g f2 e2 | d6 z2",
        ans: "z8 | z8 | z8 | z4 d2 f2 | z8 | z8 | z8 | z2 a2 f2 d2",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:boru kos.intro zil.t dem", dyn: 0.78 },
      { s: "hane1", play: "mel:zurna mel:kaba-12 ans:boru kos nakkare davul zil cevgen dem bass", dyn: 0.76 },
      { s: "teslim", play: "ref:zurna ref:kaba-12 bone:boru kos.t nakkare.t davul.t zil.t cevgen.t dem hbed drive", dyn: 0.84 },
      { s: "ceng", play: "sig:boru hum:kaba kos.ceng nakkare.ceng davul.ceng zil.ceng dem drive", dyn: 0.8, to: 0.88 },
      { s: "hane2", play: "bmel:zurna bmel:kaba-12 ans:boru kos nakkare davul zil cevgen dem bass", dyn: 0.8 },
      { s: "teslim", play: "ref:zurna ref:kaba-12 bone:boru kos.t nakkare.t davul.t zil.t cevgen.t dem hbed drive", dyn: 0.86 },
    ],
    [
      { s: "hane1", play: "mel:zurna mel:kaba-12 kos nakkare davul cevgen dem bass", dyn: 0.76 },
      { s: "teslim", play: "ref:zurna ref:kaba-12 bone:boru kos.t nakkare.t davul.t zil.t cevgen.t dem hbed drive", dyn: 0.84 },
      { s: "hane2", play: "bmel:zurna bmel:kaba-12 ans:boru kos nakkare davul zil cevgen dem bass", dyn: 0.8 },
      { s: "ceng", play: "sig:boru hum:kaba kos.ceng nakkare.ceng davul.ceng zil.ceng dem drive", dyn: 0.8, to: 0.88 },
      { s: "teslim", play: "ref:zurna ref:kaba-12 bone:boru kos.t nakkare.t davul.t zil.t cevgen.t dem hbed drive", dyn: 0.86 },
    ],
  ],
  rest: [0, 0],
  level: 1.12,
};
