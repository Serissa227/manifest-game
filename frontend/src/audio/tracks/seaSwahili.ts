// 《达乌船的归期》：斯瓦希里海岸的海（摩加迪沙到基尔瓦、桑给巴尔与奔巴之间的水道）——东北季风把达乌船从阿拉伯与印度送来，
// 等到西南季风起了再送回去，船什么时候回，全听风的。这片海原来借印度洋的《季风之路》，现在有了自己的一首（两首轮着放）。
// 第九批 A01（2026-11-11）新写，旋律原创。G 混合利底亚（还原 F），12/8 拍（每分钟 104 个四分音符，一小节四拍、每拍三个八分音符）：
// - 引子：拇指琴的固定音型与卡亚姆巴沙箱先起，乌德琴带一句弱起进来；
// - A：乌德琴领奏（阿拉伯商人带来的琴，在这里弹的是岸上的调子），一句一小节，G → F → C → G；再来时句子加密，卡农琴跟着；
// - B：祖马里（双簧的小唢呐）吹一段更直的旋律，恩戈马鼓往前站，F 与 G 两个和弦来回；
// - 最后一遍 A 乌德琴与卡农琴齐奏，塔里框鼓加进来；尾声落回主音。
// 拇指琴的固定音型从头走到尾（岸上的姆比拉一类的琴都是这样一圈圈地转）；衬底是很轻的弦乐长音与拨奏低音（管弦版换成真的弦乐）。
import type { TrackDef } from "../score";

export const SEA_SWAHILI: TrackDef = {
  id: "sea_swahili",
  title: { zh: "达乌船的归期" },
  qpm: 104,
  meter: [12, 8],
  key: "G mixolydian",
  level: 1.22,
  voices: {
    ud: { inst: "ud", gain: 0.56, pan: -0.14, reverb: 0.28 },
    kanun: { inst: "kanun", gain: 0.32, pan: 0.28, reverb: 0.3 },
    zum: { inst: "zumari", gain: 0.46, pan: 0.08, reverb: 0.36 },
    kal: { inst: "kalimba", gain: 0.34, pan: 0.3, reverb: 0.3, pattern: { kind: "arp", low: 55, steps: "1 . 5 8 . 5 3 . 5 8 . 5", ring: 2 } },
    ngoma: {
      inst: "perc",
      gain: 0.36,
      pan: -0.06,
      reverb: 0.24,
      pattern: {
        a: { kind: "drum", steps: "M..m..M.m...", hits: { M: ["msondo", 0.6], m: ["msondo", 0.36] } },
        b: { kind: "drum", steps: "M.cm.cM.mc.c", hits: { M: ["msondo", 0.62], m: ["msondo", 0.38], c: ["chapuo", 0.34] } },
      },
    },
    kay: { inst: "perc", gain: 0.22, pan: 0.2, reverb: 0.24, pattern: { kind: "drum", steps: "k.kk.kk.kk.k", hits: { k: ["kayamba", 0.4] } } },
    tari: { inst: "perc", gain: 0.28, pan: -0.24, reverb: 0.28, pattern: { kind: "drum", steps: "T.....t..t..", hits: { T: ["tari", 0.54], t: ["tari_tek", 0.3] } } },
    // 衬底（合成）
    pad: { inst: "strings", gain: 0.14, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 55, high: 72, size: 3 } },
    pz: { inst: "pizz", gain: 0.2, pan: 0.05, reverb: 0.16, pattern: { kind: "arp", low: 31, steps: "1 . . . . . 5 . . 1 . .", ring: 3 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "G | G",
      lines: { pick: "z12 | z6 d3 B2 A" },
    },
    A: {
      bars: 4,
      chords: "G | F | C | G",
      lines: {
        mel: "d3 B2 d g3 f2 d | c3 A2 c f3 e2 c | e3 g2 e c3 d2 e | d3 B2 A G6",
        mel2: "B2 d g2 a g3 d3 | A2 c f2 g f3 c3 | e2 g e2 d c3 e3 | d2 e d2 B G6",
      },
    },
    B: {
      bars: 4,
      chords: "F | G | F | G",
      lines: {
        bmel: "c3 A3 c2 d c3 | B3 G3 B2 c d3 | c3 f3 e2 d c3 | d3 B3 G6",
      },
    },
    outro: {
      bars: 2,
      chords: "F | G",
      lines: { tag: "c3 A2 c f3 e2 c | d3 B2 A G6" },
    },
  },
  forms: [
    [
      { s: "intro", play: "pick:ud kal kay", dyn: 0.54, to: 0.6 },
      { s: "A", play: "mel:ud kal ngoma.a kay pz", dyn: 0.64 },
      { s: "A", play: "mel2:ud kal ngoma.b kay pad pz", dyn: 0.68 },
      { s: "B", play: "bmel:zum kal ngoma.b kay tari pz", dyn: 0.68 },
      { s: "A", play: "mel:ud mel:kanun kal ngoma.a kay pad pz", dyn: 0.68 },
      { s: "B", play: "bmel:zum bmel:ud-12 kal ngoma.b kay tari pad pz", dyn: 0.72 },
      { s: "A", play: "mel2:ud mel2:kanun kal ngoma.b kay tari pad pz", dyn: 0.74 },
      { s: "outro", play: "tag:ud kal kay pad", dyn: 0.62, to: 0.44, rit: 0.84 },
    ],
    [
      { s: "intro", play: "pick:ud kal kay", dyn: 0.54, to: 0.6 },
      { s: "A", play: "mel:kanun kal ngoma.a kay pz", dyn: 0.62 },
      { s: "A", play: "mel:ud kal ngoma.a kay pad pz", dyn: 0.66 },
      { s: "B", play: "bmel:zum kal ngoma.b kay tari pz", dyn: 0.68 },
      { s: "B", play: "bmel:zum bmel:ud-12 kal ngoma.b kay tari pad pz", dyn: 0.7 },
      { s: "A", play: "mel2:ud kal ngoma.b kay pad pz", dyn: 0.7 },
      { s: "A", play: "mel2:ud mel2:kanun kal ngoma.b kay tari pad pz", dyn: 0.74 },
      { s: "outro", play: "tag:ud kal kay pad", dyn: 0.62, to: 0.44, rit: 0.84 },
    ],
  ],
  rest: [25, 45],
};
