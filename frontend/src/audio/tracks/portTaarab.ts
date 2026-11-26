// 《满月的塔拉布》：斯瓦希里海岸的港口（基尔瓦、桑给巴尔、蒙巴萨、马林迪、帕泰、摩加迪沙）的第二首——满月的晚上，
// 珊瑚石房子的屋顶平台上，有人弹乌德琴、有人敲鼓，唱的是从阿拉伯传来、在海岸上改了口音的歌（后来叫“塔拉布”）。
// 与《珊瑚石的城》轮着放。第九批 A01（2026-11-11）新写，旋律原创。
// E 上的巴亚提（二级降四分之一音：F 偏高四分之一），4/4 拍（每分钟 88 拍），不急：
// - 引子：拇指琴的固定音型与卡亚姆巴沙箱，乌德琴带一句弱起；
// - A：乌德琴领奏，句尾是巴亚提的收束（G → 偏高的 F → E）；再来时卡农琴高八度跟着（齐奏里各走各的装饰）；
// - B：祖马里在 A 上吹高处的一段，塔里框鼓加进来，最后同一个收束落回主音；
// - 最后一遍 A 乌德琴与卡农琴一起；尾声落在主音上。
// 不写三和弦，只有空五度；拇指琴的固定音型从头转到尾；衬底是很轻的持续音与拨奏低音（管弦版换成真的弦乐）。
import type { TrackDef } from "../score";

export const PORT_TAARAB: TrackDef = {
  id: "port_taarab",
  title: { zh: "满月的塔拉布" },
  qpm: 88,
  meter: [4, 4],
  key: "E bayati",
  level: 1.33,
  voices: {
    ud: { inst: "ud", gain: 0.56, pan: -0.14, reverb: 0.28 },
    kanun: { inst: "kanun", gain: 0.32, pan: 0.28, reverb: 0.3 },
    zum: { inst: "zumari", gain: 0.46, pan: 0.08, reverb: 0.36 },
    kal: { inst: "kalimba", gain: 0.32, pan: 0.3, reverb: 0.3, pattern: { kind: "arp", low: 52, steps: "1 . 5 8 . 5 8 .", ring: 2 } },
    ngoma: {
      inst: "perc",
      gain: 0.34,
      pan: -0.06,
      reverb: 0.24,
      pattern: {
        a: { kind: "drum", steps: "M..mM...", hits: { M: ["msondo", 0.58], m: ["msondo", 0.34] } },
        b: { kind: "drum", steps: "M.cmM.c.", hits: { M: ["msondo", 0.6], m: ["msondo", 0.36], c: ["chapuo", 0.32] } },
      },
    },
    kay: { inst: "perc", gain: 0.2, pan: 0.2, reverb: 0.24, pattern: { kind: "drum", steps: "k.kkk.kk", hits: { k: ["kayamba", 0.38] } } },
    tari: { inst: "perc", gain: 0.26, pan: -0.24, reverb: 0.28, pattern: { kind: "drum", steps: "T.....t.", hits: { T: ["tari", 0.5], t: ["tari_tek", 0.28] } } },
    // 衬底（合成）
    drone: { inst: "drone", gain: 0.15, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 52, high: 69, size: 2 } },
    pz: { inst: "pizz", gain: 0.18, pan: 0.05, reverb: 0.16, pattern: { kind: "arp", low: 40, steps: "1 . . . 5 . . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "E5 | E5",
      lines: { pick: "z8 | z4 B2 A G" },
    },
    A: {
      bars: 8,
      chords: "E5 | E5 | A5 | E5 | D5 | E5 | A5 | E5",
      lines: {
        mel: "E2 F G A2 B2 | B2 c B A2 G2 | A2 B c d2 c2 | B2 A G F2 E2 | D2 F G A2 d2 | e2 d c B2 A2 | c2 B A G2 F2 | G F E F E4",
      },
    },
    B: {
      bars: 8,
      chords: "A5 | A5 | G5 | G5 | D5 | D5 | E5 | E5",
      lines: {
        bmel: "A2 c2 e2 d c | B2 A2 c4 | G2 B2 d2 c B | A2 G2 B4 | A2 d2 f2 e d | c2 B2 A4 | G2 B2 A2 G F | G F E F E4",
      },
    },
    outro: {
      bars: 2,
      chords: "A5 | E5",
      lines: { tag: "c2 B A G2 F2 | E8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "pick:ud kal kay", dyn: 0.52, to: 0.58 },
      { s: "A", play: "mel:ud kal ngoma.a kay pz", dyn: 0.62 },
      { s: "A", play: "mel:ud mel:kanun+12 kal ngoma.a kay drone pz", dyn: 0.66 },
      { s: "B", play: "bmel:zum kal ngoma.b kay tari drone pz", dyn: 0.66, to: 0.7 },
      { s: "A", play: "mel:ud mel:kanun+12 kal ngoma.b kay tari drone pz", dyn: 0.72, to: 0.68 },
      { s: "outro", play: "tag:ud kal kay drone", dyn: 0.6, to: 0.44, rit: 0.84 },
    ],
    [
      { s: "intro", play: "pick:ud kal kay", dyn: 0.52, to: 0.58 },
      { s: "A", play: "mel:kanun kal ngoma.a kay pz", dyn: 0.6 },
      { s: "B", play: "bmel:zum kal ngoma.a kay drone pz", dyn: 0.64 },
      { s: "B", play: "bmel:zum bmel:ud kal ngoma.b kay tari drone pz", dyn: 0.68, to: 0.7 },
      { s: "A", play: "mel:ud mel:kanun+12 kal ngoma.b kay tari drone pz", dyn: 0.72, to: 0.68 },
      { s: "outro", play: "tag:ud kal kay drone", dyn: 0.6, to: 0.44, rit: 0.84 },
    ],
  ],
  rest: [10, 18],
};
