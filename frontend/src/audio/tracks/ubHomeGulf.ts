// 《椰枣林的井》：养成篇·家乡的日常——阿拉伯的海湾（纳吉玛的尤尔法：领航世家、椰枣林、引水的暗渠与井，夏天男人们出海采珠）。旋律原创。
// 傍晚井边的歌：海湾一带的“骚特”（sawt）——乌德琴领唱，竖拉的提琴跟着，众人拍手；采珠人的家里还有陶罐（贾赫拉）当鼓。
// A 上的巴亚提（B 降四分之一音：A B半降 C D E F G），4/4（每分钟 86 拍）：
// - 引子：乌德琴在 A 的持续音上随手弹两小节（像塔克西姆），没有鼓；
// - A：乌德琴唱主题（第一小节 A B半降 C D 是巴亚提的下四音列，句尾落回 A），米尔瓦斯小鼓（一只手托着的双面小鼓）打骚特的步子；
//   再一遍提琴与乌德琴同一条旋律，众人在拍子后面拍手（海湾歌舞里那种切分的掌声），陶罐“噗”地应；
// - B：西姆西米亚琴（红海与海湾水手弹的里拉琴）与米兹玛尔（“利瓦”舞乐的双簧管）低八度、提琴在上，唱一段同音反复的“呼唤”（像在井边喊人回家），
//   G、C 上的空五度一换，又落回 A；
// - A″：全体，尾声落回 A。
// 和声不写西洋的三和弦：只有空五度的持续音（A–E，四级上 D–A，七级 G–D，三级 C–G）。衬底（合成的持续音与很轻的拨奏）管弦版换成很轻的弦乐，
// 提琴换成真的小提琴。
import type { TrackDef } from "../score";

export const UB_HOME_GULF: TrackDef = {
  id: "ub_home_gulf",
  title: { zh: "椰枣林的井" },
  qpm: 86,
  meter: [4, 4],
  key: "A bayati",
  voices: {
    ud: { inst: "ud", gain: 0.6, pan: -0.12, reverb: 0.26 },
    sims: { inst: "simsimiyya", gain: 0.46, pan: 0.24, reverb: 0.28 },
    fid: { inst: "fiddle", gain: 0.4, pan: 0.14, reverb: 0.3 },
    // 米兹玛尔：尤尔法一带的“利瓦”舞乐里吹的那种双簧管，只在 B 段低八度跟着“呼唤”
    mizmar: { inst: "mizmar", gain: 0.28, pan: -0.2, reverb: 0.32 },
    mirwas: {
      inst: "perc",
      gain: 0.3,
      pan: 0.08,
      reverb: 0.2,
      pattern: {
        a: { kind: "drum", steps: "D.T.DDT.", hits: { D: ["mirwas_dum", 0.6], T: ["mirwas_tak", 0.46] } },
        s: { kind: "drum", steps: "D...D.T.", hits: { D: ["mirwas_dum", 0.5], T: ["mirwas_tak", 0.36] } },
      },
    },
    claps: { inst: "perc", gain: 0.22, pan: -0.26, reverb: 0.3, pattern: { kind: "drum", steps: "...P..PP", hits: { P: ["tasfiq", 0.4] } } },
    jahlah: { inst: "perc", gain: 0.24, pan: 0.28, reverb: 0.24, pattern: { kind: "drum", steps: "J...j...", hits: { J: ["jahlah", 0.52], j: ["jahlah_tak", 0.32] } } },
    // 衬底（合成）：A–E 的持续音、每小节一下很轻的拨奏
    dem: { inst: "drone", gain: 0.14, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 50, high: 69, size: 2 } },
    pz: { inst: "pizz", gain: 0.18, pan: 0.06, reverb: 0.16, pattern: { kind: "arp", low: 33, steps: "1 . . . 5 . . .", ring: 3 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "A5 | A5",
      lines: { tq: "A/2B/2c/2d/2 e2 d/2c/2B/2c/2 A2 | B/2c/2B/2A/2 G2 A4" },
    },
    A: {
      bars: 8,
      chords: "A5 | A5 | D5 | A5 | C5 | D5 | G5 | A5",
      lines: {
        mel: "A2 B c d2 c B | c2 B2 A4 | d2 e f e2 d2 | c3 B A2 G2 | G2 A B c2 d2 | e3 d c2 d2 | d2 c B A2 G2 | A8",
      },
    },
    B: {
      bars: 8,
      chords: "D5 | D5 | A5 | A5 | G5 | C5 | D5 | A5",
      lines: {
        // 同音反复的“呼唤”
        bm: "d2 d d f2 e d | e2 d c d4 | c2 c c e2 d c | B2 A6 | d2 d d g2 f e | f2 e d e4 | d2 c B c2 B A | A8",
      },
    },
    coda: {
      bars: 2,
      chords: "A5 | A5",
      lines: { cd: "c2 B A G2 A2 | A8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "tq:ud dem", dyn: 0.56 },
      { s: "A", play: "mel:ud mirwas.s dem pz", dyn: 0.6 },
      { s: "A", play: "mel:ud mel:fid mirwas.a claps jahlah dem pz", dyn: 0.64 },
      { s: "B", play: "bm:fid bm:sims-12 bm:mizmar-12 mirwas.s claps dem", dyn: 0.62 },
      { s: "A", play: "mel:ud mel:fid mel:sims-12 mirwas.a claps jahlah dem pz", dyn: 0.68 },
      { s: "coda", play: "cd:ud cd:fid dem", dyn: 0.6, to: 0.44, rit: 0.84 },
    ],
    [
      { s: "intro", play: "tq:ud dem", dyn: 0.54 },
      { s: "A", play: "mel:sims dem pz", dyn: 0.58 },
      { s: "B", play: "bm:ud-12 mirwas.s dem", dyn: 0.6 },
      { s: "A", play: "mel:ud mel:fid mirwas.a claps jahlah dem pz", dyn: 0.64 },
      { s: "B", play: "bm:fid bm:sims-12 bm:mizmar-12 mirwas.s claps jahlah dem", dyn: 0.64 },
      { s: "A", play: "mel:ud mel:fid mel:sims-12 mirwas.a claps jahlah dem pz", dyn: 0.68 },
      { s: "coda", play: "cd:ud cd:fid dem", dyn: 0.6, to: 0.44, rit: 0.84 },
    ],
  ],
  rest: [10, 16],
  level: 1.12,
};
