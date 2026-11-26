// 《珊瑚石的城》：斯瓦希里的港口（基尔瓦、蒙巴萨、马林迪、桑给巴尔、拉穆——珊瑚石砌的房子与清真寺，阿拉伯的帆船与非洲的鼓）。
// 地方特色第一阶段重编：斯瓦希里海岸的乐器领奏（复古合成版的衬底用合成的弦乐与拨奏低音）。旋律沿用第三轮的原创旋律。
// F 利底亚（还原 B），4/4（每分钟 108 拍），3 + 3 + 2 的分拍——阿拉伯的那一半与非洲的那一半合在一起：
// - 引子：拇指琴（铁环沙沙响）两只拇指交替地转一个小圈，恩戈马鼓（大的姆松多“咚 · · 咚 · · 咚 ·”、小的恰普奥填在中间）与卡亚姆巴沙箱进来；
// - A：乌德琴领奏（塔拉布的那一半），拇指琴一直转；再一遍提琴与乌德琴齐奏、卡农琴分解；
// - B：一领众和——提琴（第二遍是祖马里双簧管）领两小节，人声与乌德琴应两小节，塔里框鼓加进来；
// - A″：全体，慢下来收住。
import type { TrackDef } from "../score";

export const PORT_SWAHILI: TrackDef = {
  id: "port_swahili",
  title: { zh: "珊瑚石的城", en: "The Coral-Stone Town" },
  qpm: 108,
  meter: [4, 4],
  key: "F lydian",
  voices: {
    ud: { inst: "ud", gain: 0.58, pan: -0.14, reverb: 0.26 },
    fiddle: { inst: "fiddle", gain: 0.46, pan: 0.16, reverb: 0.3 },
    choir: { inst: "choir", gain: 0.4, pan: 0.06, reverb: 0.4 },
    zumari: { inst: "zumari", gain: 0.36, pan: -0.04, reverb: 0.32 },
    kanun: { inst: "kanun", gain: 0.22, pan: 0.32, reverb: 0.3, pattern: { kind: "arp", low: 53, steps: "1 5 8 5 10 8 12 8", ring: 2 } },
    kalimba: { inst: "kalimba", gain: 0.3, pan: 0.24, reverb: 0.24, pattern: { kind: "arp", low: 53, grid: 0.5, steps: "1 - 8 5 - 10 8 - 1 - 8 5 - 12 10 -" } },
    ngoma: {
      inst: "perc",
      gain: 0.32,
      pan: 0.06,
      reverb: 0.22,
      pattern: {
        intro: { kind: "drum", steps: "................MccMccMcMccMccMc", hits: { M: ["msondo", 0.65], c: ["chapuo", 0.42] } },
        a: { kind: "drum", steps: "MccMccMc", hits: { M: ["msondo", 0.65], c: ["chapuo", 0.42] } },
      },
    },
    kayamba: {
      inst: "perc",
      gain: 0.28,
      pan: -0.3,
      reverb: 0.2,
      pattern: {
        intro: { kind: "drum", steps: "................K.kK.kK.K.kK.kK.", hits: { K: ["kayamba", 0.5], k: ["kayamba", 0.3] } },
        a: { kind: "drum", steps: "K.kK.kK.", hits: { K: ["kayamba", 0.5], k: ["kayamba", 0.3] } },
      },
    },
    tari: { inst: "perc", gain: 0.26, pan: 0.3, reverb: 0.24, pattern: { kind: "drum", steps: "T..t..t.", hits: { T: ["tari", 0.55], t: ["tari_tek", 0.45] } } },
    // 衬底（合成）：弦乐的长音、拨奏的低音
    strings: { inst: "strings", gain: 0.2, pan: -0.24, reverb: 0.4, pattern: { kind: "pad", low: 57, high: 72, size: 3 } },
    bass: { inst: "pizz", gain: 0.32, pan: 0.05, reverb: 0.15, pattern: { kind: "arp", low: 36, steps: "1 . . 5, . . 1 .", ring: 2 } },
  },
  sections: {
    intro: { bars: 4, chords: "F | G/F | F | C" },
    A: {
      bars: 8,
      // 利底亚的二级：F 上的 G 大三和弦
      chords: "F | G/F | F | C | Dm | G/F | C | F",
      lines: { mel: "c2 A2 c d c A | B2 d2 B A G2 | A3 G F2 A2 | G6 z2 | f2 e2 d2 f2 | g3 f d2 B2 | c2 e2 d c B c | A6 z2" },
    },
    B: {
      bars: 8,
      chords: "Dm | Am | C | G/F | Dm | Am | C | F",
      lines: {
        // 一领：提琴（第二遍祖马里）
        call: "d3 d d2 f2 | e6 z2 | z8 | z8 | a3 a a2 g2 | e6 z2 | z8 | z8",
        // 众和：人声与乌德琴
        resp: "z8 | z8 | e2 g2 e2 c2 | d6 z2 | z8 | z8 | e2 d2 c2 B2 | c6 z2",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "kalimba ngoma.intro kayamba.intro", dyn: 0.62 },
      { s: "A", play: "mel:ud kalimba ngoma.a kayamba.a bass", dyn: 0.66 },
      { s: "A", play: "mel:ud mel:fiddle kanun kalimba ngoma.a kayamba.a strings bass", dyn: 0.68 },
      { s: "B", play: "call:fiddle resp:choir resp:ud-12 kalimba ngoma.a kayamba.a bass", dyn: 0.68 },
      { s: "B", play: "call:zumari resp:choir resp:ud kalimba tari ngoma.a kayamba.a strings bass", dyn: 0.72 },
      { s: "A", play: "mel:ud mel:fiddle kanun kalimba tari ngoma.a kayamba.a strings bass", dyn: 0.7, rit: 0.92 },
    ],
    [
      { s: "A", play: "mel:fiddle kalimba ngoma.a kayamba.a bass", dyn: 0.64 },
      { s: "B", play: "call:zumari resp:choir resp:ud-12 kalimba tari ngoma.a kayamba.a bass", dyn: 0.68 },
      { s: "A", play: "mel:ud kanun kalimba ngoma.a kayamba.a strings bass", dyn: 0.68, rit: 0.92 },
    ],
  ],
  rest: [10, 18],
  level: 1.12,
};
