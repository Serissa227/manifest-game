// 《码头上的布雷舞》：法兰西的港口（马赛、波尔多、拉罗谢尔、南特、鲁昂、迪耶普、圣马洛……码头边的酒馆与节日）。
// 地方特色第二阶段（北欧）：地方乐器领奏（复古合成版的衬底用合成的弦乐群与大提琴组）。
// G 大调，6/8 拍写的三拍子布雷舞（bourrée à trois temps：每个 3/8 是“长—短”，一小节两步），每分钟 100 个四分音符：
// - 引子：手摇弦琴先摇起来——持续音弦（G2 与 D3）响起，“狗”（chien）在每一步的第一、三拍“嗞”，旋律还没进来；
// - A：手摇弦琴奏布雷舞，第二遍法兰西风笛（cornemuse）同度齐奏（贝里与奥弗涅的“弦琴与风笛”这一对）；
// - B：风笛领第二段，手摇弦琴只摇持续音与狗的节奏；
// - C：普罗旺斯的加卢贝笛与长鼓（一人同奏的 galoubet–tambourin）跳一段法兰多拉，持续音停下；
// - A″：三件一起（加卢贝笛高八度），狗与长鼓同打；尾声：弦琴收在 G 上，狗最后几下。
// 和声不写西洋的和弦进行：手摇弦琴与风笛的音乐只有持续音（G–D 的空五度）。
import type { TrackDef } from "../score";

export const PORT_FRANCE: TrackDef = {
  id: "port_france",
  title: { zh: "码头上的布雷舞", en: "Bourrée on the Quay" },
  qpm: 100,
  meter: [6, 8],
  key: "G major",
  voices: {
    vielle: { inst: "hurdygurdy", gain: 0.5, pan: -0.12, reverb: 0.24 },
    bourdon: { inst: "hurdy_drone", gain: 0.44, pan: -0.12, reverb: 0.26, pattern: { kind: "drone", notes: [43, 50] } },
    chien: {
      inst: "perc",
      gain: 0.3,
      pan: -0.1,
      reverb: 0.22,
      pattern: {
        a: { kind: "drum", steps: "C.cC.c", hits: { C: ["chien_d", 0.8], c: ["chien_d", 0.45] } },
        b: { kind: "drum", steps: "C.cCccC.cC.c", hits: { C: ["chien_d", 0.85], c: ["chien_d", 0.45] } },
        intro: { kind: "drum", steps: "C..C..C.cC.c", hits: { C: ["chien_d", 0.75], c: ["chien_d", 0.4] } },
        coda: { kind: "drum", steps: "C.cC.cC.....", hits: { C: ["chien_d", 0.85], c: ["chien_d", 0.45] } },
      },
    },
    muse: { inst: "cornemuse", gain: 0.46, pan: 0.18, reverb: 0.26 },
    galou: { inst: "galoubet", gain: 0.4, pan: 0.26, reverb: 0.3 },
    tamb: {
      inst: "perc",
      gain: 0.3,
      pan: 0.24,
      reverb: 0.26,
      pattern: {
        a: { kind: "drum", steps: "T.tT.tT.tTtt", hits: { T: ["tambourin", 0.8], t: ["tambourin_ta", 0.5] } },
        coda: { kind: "drum", steps: "T.tT.tT.....", hits: { T: ["tambourin", 0.85], t: ["tambourin_ta", 0.5] } },
      },
    },
    // 衬底（合成）：弦乐群很轻的空五度、大提琴组的 G
    pad: { inst: "strings", gain: 0.13, pan: 0.2, reverb: 0.42, pattern: { kind: "pad", low: 55, high: 69, size: 2 } },
    low: { inst: "celli", gain: 0.16, pan: 0.12, reverb: 0.26, pattern: { kind: "arp", low: 43, steps: "1 . . . . .", ring: 6 } },
  },
  sections: {
    intro: { bars: 2, chords: "G5 | G5" },
    A: {
      bars: 8,
      chords: "G5 | G5 | G5 | G5 | G5 | G5 | G5 | G5",
      lines: { mel: "G2 B d2 B | c2 e d2 B | A2 B c2 A | B3 G3 | G2 B d2 g | e2 g f2 e | d2 B A2 B | G6" },
    },
    B: {
      bars: 8,
      chords: "G5 | G5 | G5 | G5 | G5 | G5 | G5 | G5",
      lines: { bmel: "d2 e f2 d | g2 f e2 d | c2 e d2 B | A3 d3 | d2 e f2 g | a2 g f2 e | d2 B c2 A | G6" },
    },
    C: {
      bars: 8,
      chords: "G5 | G5 | G5 | G5 | G5 | G5 | G5 | G5",
      // 法兰多拉：加卢贝笛在高处
      lines: { cmel: "d'2 b g2 b | c'2 a f2 a | b2 g d2 g | a3 d3 | d'2 b g2 b | e'2 c' a2 c' | b2 a g2 f | g6" },
    },
    coda: {
      bars: 2,
      chords: "G5 | G5",
      lines: { end: "d2 B A2 B | G6" },
    },
  },
  forms: [
    [
      { s: "intro", play: "bourdon chien.intro low", dyn: 0.6, to: 0.66 },
      { s: "A", play: "mel:vielle bourdon chien low pad", dyn: 0.68 },
      { s: "A", play: "mel:vielle mel:muse bourdon chien low pad", dyn: 0.72 },
      { s: "B", play: "bmel:muse bourdon chien low pad", dyn: 0.68 },
      { s: "C", play: "cmel:galou tamb low pad", dyn: 0.66 },
      { s: "A", play: "mel:vielle mel:muse mel:galou+12 bourdon chien.b tamb low pad", dyn: 0.76 },
      { s: "coda", play: "end:vielle bourdon chien.coda tamb.coda low", dyn: 0.74, rit: 0.9 },
    ],
    [
      { s: "A", play: "mel:muse bourdon chien low pad", dyn: 0.66 },
      { s: "C", play: "cmel:galou tamb low pad", dyn: 0.66 },
      { s: "B", play: "bmel:vielle bourdon chien low pad", dyn: 0.68 },
      { s: "A", play: "mel:vielle mel:muse mel:galou+12 bourdon chien.b tamb low pad", dyn: 0.76 },
      { s: "coda", play: "end:vielle bourdon chien.coda tamb.coda low", dyn: 0.74, rit: 0.9 },
    ],
  ],
  rest: [10, 18],
  level: 1.18,
};
