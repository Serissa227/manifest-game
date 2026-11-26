// 《采珠船》：阿拉伯的海（波斯湾、阿曼湾与阿拉伯海、亚丁湾、红海）——夏天采珠的船队在浅滩上一停几个月，
// 领唱的“纳哈姆”起一句，全船的人拍着手、敲着陶罐应一句。与《星与三角帆》在同一片海轮着放。
// 第九批 A01（2026-11-11）新写，旋律原创。G 上的拉斯特（三级与七级是“中立音”：B 与 F 各偏四分之一音），6/8 拍（每分钟 108 拍）：
// - 引子：拍手与陶罐先起，乌德琴拨一句引子；
// - A：乌德琴领奏，一句四小节、句尾落回主音；再来时红海的西姆西米亚琴跟着弹同一条旋律（齐奏里各走各的装饰）；
// - B：一呼一应——奈伊笛（最后一遍是米兹玛尔）起一小节，乌德琴与西姆西米亚琴齐声应一小节，像领唱与全船的人；
// - 最后一遍 A 由米兹玛尔领着，米尔瓦斯小鼓、拍手、陶罐全上。
// 不写三和弦：只有空五度（G–D、C–G、D–A）的持续音；衬底是很轻的持续音与拨奏低音（管弦版换成真的弦乐）。
import type { TrackDef } from "../score";

export const SEA_GULF: TrackDef = {
  id: "sea_gulf",
  title: { zh: "采珠船" },
  qpm: 108,
  meter: [6, 8],
  key: "G rast",
  level: 1.29,
  voices: {
    ud: { inst: "ud", gain: 0.56, pan: -0.12, reverb: 0.28 },
    sims: { inst: "simsimiyya", gain: 0.4, pan: 0.26, reverb: 0.28 },
    nay: { inst: "nay", gain: 0.5, pan: 0.12, reverb: 0.4 },
    mizmar: { inst: "mizmar", gain: 0.42, pan: -0.04, reverb: 0.36 },
    mirw: { inst: "perc", gain: 0.36, pan: 0.14, reverb: 0.22, pattern: { kind: "drum", steps: "D..T.t", hits: { D: ["mirwas_dum", 0.6], T: ["mirwas_tak", 0.42], t: ["mirwas_tak", 0.28] } } },
    clap: {
      inst: "perc",
      gain: 0.3,
      pan: -0.22,
      reverb: 0.26,
      pattern: {
        a: { kind: "drum", steps: "c..c..", hits: { c: ["tasfiq", 0.5] } },
        b: { kind: "drum", steps: "c.lc.c", hits: { c: ["tasfiq", 0.52], l: ["tasfiq_low", 0.34] } },
      },
    },
    jah: { inst: "perc", gain: 0.3, pan: 0.3, reverb: 0.24, pattern: { kind: "drum", steps: "j.tj.t j.tjtt", hits: { j: ["jahlah", 0.5], t: ["jahlah_tak", 0.3] } } },
    // 衬底（合成）
    drone: { inst: "drone", gain: 0.17, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 50, high: 67, size: 2 } },
    pz: { inst: "pizz", gain: 0.2, pan: 0.05, reverb: 0.16, pattern: { kind: "arp", low: 31, steps: "1 . . 1 . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "G5 | G5 | G5 | G5",
      lines: { taq: "G,3 D3 | G6 | z3 A2 B | c2 B A3" },
    },
    A: {
      bars: 8,
      chords: "G5 | G5 | C5 | G5 | D5 | C5 | D5 | G5",
      lines: {
        mel: "G2 A B2 c | d3 c B A | c2 d e2 d | c B A G3 | d2 e f2 e | d c B c2 A | B2 A B c d | B A B G3",
      },
    },
    B: {
      bars: 8,
      chords: "G5 | G5 | D5 | D5 | C5 | C5 | D5 | G5",
      lines: {
        // 领唱的一句
        call: "d3 e2 d | z6 | e3 f2 e | z6 | g3 f e d | z6 | d2 c B A B | z6",
        // 全船的人应的一句
        resp: "z6 | B2 A G3 | z6 | A2 B A3 | z6 | e2 d c3 | z6 | B A B G3",
      },
    },
    outro: {
      bars: 4,
      chords: "C5 | D5 | G5 | G5",
      lines: { tag: "e2 d c2 d | B2 A B c d | G6 | z6" },
    },
  },
  forms: [
    [
      { s: "intro", play: "taq:ud clap.a jah drone", dyn: 0.54, to: 0.62 },
      { s: "A", play: "mel:ud mirw clap.a jah pz", dyn: 0.64 },
      { s: "A", play: "mel:ud mel:sims mirw clap.b jah drone pz", dyn: 0.68 },
      { s: "B", play: "call:nay resp:ud resp:sims mirw clap.a jah drone pz", dyn: 0.68 },
      { s: "A", play: "mel:mizmar mel:ud mirw clap.b jah drone pz", dyn: 0.72 },
      { s: "B", play: "call:mizmar resp:ud resp:sims mirw clap.b jah drone pz", dyn: 0.72 },
      { s: "outro", play: "tag:ud clap.a jah drone", dyn: 0.62, to: 0.44, rit: 0.86 },
    ],
    [
      { s: "intro", play: "taq:ud clap.a drone", dyn: 0.54, to: 0.6 },
      { s: "A", play: "mel:sims mirw clap.a jah pz", dyn: 0.62 },
      { s: "B", play: "call:nay resp:ud mirw clap.a jah drone pz", dyn: 0.66 },
      { s: "A", play: "mel:ud mel:sims mirw clap.b jah drone pz", dyn: 0.68 },
      { s: "B", play: "call:mizmar resp:ud resp:sims mirw clap.b jah drone pz", dyn: 0.72 },
      { s: "A", play: "mel:mizmar mel:ud mel:sims mirw clap.b jah drone pz", dyn: 0.74 },
      { s: "outro", play: "tag:ud clap.a jah drone", dyn: 0.62, to: 0.44, rit: 0.86 },
    ],
  ],
  rest: [25, 45],
};
