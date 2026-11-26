// 《河口的晚风》：法兰西人的港口（迪耶普、勒阿弗尔、圣马洛、南特、拉罗谢尔、波尔多、马赛……）的第二首——收了工的傍晚，
// 码头边的小酒馆门口有人摇起手摇弦琴，持续音弦一直嗡着，过路的人跟着哼。与《码头上的布雷舞》轮着放（那一首是 6/8 的快舞，这一首是 3/4 的慢步子）。
// 第九批 A01（2026-11-11）新写，旋律原创。D 多利亚（还原 B），3/4 拍（每分钟 96 拍），持续音弦从头到尾守着 D 与 A：
// - 引子：持续音弦与普罗旺斯长鼓，加卢贝笛在高处吹一句；
// - A：手摇弦琴唱主题；A′：加卢贝笛在高处唱答句（G 大三和弦里的还原 B 是多利亚的那一下亮）；
// - B：风笛接过去，落到 G 上吹一段更沉的舞步（持续音不动，上面的和声在走），最后爬回主音；
// - 最后一遍 A 手摇弦琴与风笛齐奏；尾声收在主音上。
// 鲁特琴的分解和弦垫着；弦乐群与拨奏低音只做极轻的衬底（管弦版换成真的弦乐）。
import type { TrackDef } from "../score";

export const PORT_ESTUARY: TrackDef = {
  id: "port_estuary",
  title: { zh: "河口的晚风" },
  qpm: 96,
  meter: [3, 4],
  key: "D dorian",
  level: 1.36,
  voices: {
    hg: { inst: "hurdygurdy", gain: 0.5, pan: -0.1, reverb: 0.3 },
    hd: { inst: "hurdy_drone", gain: 0.2, pan: -0.1, reverb: 0.3, pattern: { kind: "drone", notes: [50, 57] } },
    gal: { inst: "galoubet", gain: 0.36, pan: 0.18, reverb: 0.34 },
    corn: { inst: "cornemuse", gain: 0.46, pan: 0.06, reverb: 0.32 },
    luth: { inst: "liuto", gain: 0.32, pan: 0.3, reverb: 0.26, pattern: { kind: "arp", low: 50, steps: "1 . 5 8 . 5", ring: 2 } },
    tamb: {
      inst: "perc",
      gain: 0.3,
      pan: 0.14,
      reverb: 0.26,
      pattern: {
        a: { kind: "drum", steps: "T...t.", hits: { T: ["tambourin", 0.54], t: ["tambourin_ta", 0.3] } },
        b: { kind: "drum", steps: "T.t.t.", hits: { T: ["tambourin", 0.56], t: ["tambourin_ta", 0.32] } },
      },
    },
    // 衬底（合成）
    pad: { inst: "strings", gain: 0.13, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 55, high: 72, size: 3 } },
    pz: { inst: "pizz", gain: 0.18, pan: 0.05, reverb: 0.16, pattern: { kind: "arp", low: 38, steps: "1 . . . 5 .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "Dm | Dm | C | Dm",
      lines: { call: "z6 | z6 | g2 e2 c'2 | a6" },
    },
    A: {
      bars: 8,
      chords: "Dm | C | Dm | Am | F | C | Am | Dm",
      lines: {
        mel: "d2 f2 a2 | g3 e c2 | d2 f2 e d | e4 A2 | c2 f2 a2 | g2 e2 g2 | a3 g e2 | d6",
      },
    },
    A2: {
      bars: 8,
      chords: "F | C | Dm | Am | G | Dm | Am | Dm",
      lines: {
        mel2: "f2 a2 c'2 | c'3 g e2 | f2 a2 d'2 | c'4 a2 | b2 d'2 b2 | a2 f2 d2 | e2 a2 g2 | a6",
      },
    },
    B: {
      bars: 8,
      chords: "G | G | Dm | Dm | C | G | Am | Am",
      lines: {
        bmel: "d2 B2 d2 | g3 f e2 | d2 f2 d2 | A4 d2 | e2 g2 e2 | d3 c B2 | c2 e2 c2 | A2 B c2 e",
      },
    },
    outro: {
      bars: 4,
      chords: "C | Am | Dm | Dm",
      lines: { tag: "g2 e2 g2 | a3 g e2 | d6 | z6" },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:gal hd luth tamb.a", dyn: 0.52, to: 0.58 },
      { s: "A", play: "mel:hg hd luth tamb.a pz", dyn: 0.62 },
      { s: "A2", play: "mel2:gal hd luth tamb.a pad pz", dyn: 0.64 },
      { s: "B", play: "bmel:corn hd luth tamb.b pad pz", dyn: 0.66 },
      { s: "A", play: "mel:hg mel:corn hd luth tamb.b pad pz", dyn: 0.7, to: 0.66 },
      { s: "outro", play: "tag:hg hd luth pad", dyn: 0.58, to: 0.42, rit: 0.84 },
    ],
    [
      { s: "intro", play: "call:gal hd luth", dyn: 0.52, to: 0.56 },
      { s: "A", play: "mel:corn hd luth tamb.a pz", dyn: 0.6 },
      { s: "B", play: "bmel:hg hd luth tamb.a pad pz", dyn: 0.64 },
      { s: "A2", play: "mel2:gal hd luth tamb.b pad pz", dyn: 0.66 },
      { s: "A", play: "mel:hg mel:corn hd luth tamb.b pad pz", dyn: 0.7, to: 0.66 },
      { s: "outro", play: "tag:hg hd luth pad", dyn: 0.58, to: 0.42, rit: 0.84 },
    ],
  ],
  rest: [10, 18],
};
