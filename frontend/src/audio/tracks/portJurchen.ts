// 《貂皮与东珠》：女真与满洲的边地（赫图阿拉、叶赫、乌拉……松林、人参、貂皮、东珠，与明的马市换盐、布与铁锅）。
// 地方特色第二阶段：地方乐器领奏（复古合成版的衬底用合成的持续音与大提琴组）。
// G 上泛音列的音（G A B D F：口弦只奏得出 G2 的第 4 到第 12 泛音，号角也按泛音列取音，所以没有 C 与 E；口弦的 F 是偏低的“自然七度”），6/8 拍（每分钟 120 个四分音符），像马跑的“咚 · 哒 咚 · 嗒”：
// - 引子：号角（buren）从下面推上来、一声高过一声，神鼓一下一下由疏到密，腰铃最后“哗——”地一甩；
// - A（十六小节）：口弦弹马跑一样的泛音旋律（簧片一直嗡在 G2 上），神鼓“咚 · 咚 咚 · 嗒”；第二遍号角在底下长长地吹 G 与 D，腰铃每两小节一甩；
// - B（跳神）：号角一句、口弦一句地应，神鼓越打越密、腰铃每拍都甩；再一遍更快；
// - 尾声：神鼓一串滚奏后重重一下，号角落下来。
// 不写西洋的三和弦：衬底只有 G–D 的空五度。
import type { TrackDef } from "../score";

export const PORT_JURCHEN: TrackDef = {
  id: "port_jurchen",
  title: { zh: "貂皮与东珠", en: "Sable and River Pearls" },
  qpm: 120,
  meter: [6, 8],
  key: "G mixolydian",
  voices: {
    mukun: { inst: "mukun", gain: 0.5, pan: -0.1, reverb: 0.3 },
    buren: { inst: "buren", gain: 0.42, pan: 0.18, reverb: 0.46 },
    yemcen: {
      inst: "perc",
      gain: 0.34,
      pan: 0.06,
      reverb: 0.32,
      pattern: {
        intro: { kind: "drum", steps: "D.....D.....D..d..D.dddd", hits: { D: ["yemcen", 0.8], d: ["yemcen", 0.5] } },
        // 咚 · 咚 咚 · 嗒（马跑）
        a: { kind: "drum", steps: "D.dD.e", hits: { D: ["yemcen", 0.8], d: ["yemcen", 0.45], e: ["yemcen_edge", 0.5] } },
        b: { kind: "drum", steps: "DdDDdD", hits: { D: ["yemcen", 0.85], d: ["yemcen", 0.5] } },
        // 越打越密（十六分音符）
        c: { kind: "drum", grid: 0.5, steps: "DdddedDddded", hits: { D: ["yemcen", 0.9], d: ["yemcen", 0.45], e: ["yemcen_edge", 0.6] } },
        coda: { kind: "drum", grid: 0.5, steps: "ddddddddddddD...........", hits: { D: ["yemcen", 0.95], d: ["yemcen", 0.5] } },
      },
    },
    sisa: {
      inst: "perc",
      gain: 0.22,
      pan: -0.22,
      reverb: 0.36,
      pattern: {
        intro: { kind: "drum", steps: "..................S.....", hits: { S: ["sisa", 0.75] } },
        a: { kind: "drum", steps: "S...........", hits: { S: ["sisa", 0.55] } },
        b: { kind: "drum", steps: "S..s..", hits: { S: ["sisa", 0.8], s: ["sisa_shake", 0.5] } },
        c: { kind: "drum", steps: "S.sS.s", hits: { S: ["sisa", 0.8], s: ["sisa_shake", 0.55] } },
        coda: { kind: "drum", grid: 0.5, steps: "s.s.s.s.s.s.S...........", hits: { S: ["sisa", 0.9], s: ["sisa_shake", 0.5] } },
      },
    },
    // 衬底（合成）：G–D 的持续音、大提琴组的长音
    pad: { inst: "drone", gain: 0.17, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 50, high: 64, size: 2 } },
    low: { inst: "celli", gain: 0.17, pan: 0.12, reverb: 0.26, pattern: { kind: "arp", low: 36, steps: "1 . . . . .", ring: 6 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "G5 | G5 | G5 | G5",
      lines: { hc: "!bend!D,6 | !bend!G,6 | B,2 !bend!D4 | !fall!G,6" },
    },
    A: {
      bars: 16,
      chords: "G5 | G5 | G5 | G5 | G5 | G5 | G5 | G5 | G5 | G5 | G5 | G5 | G5 | G5 | G5 | G5",
      lines: {
        // 口弦：只写 G2 的整数倍（G4 B4 D5 F5 G5 A5 B5）
        jh: "G B d G B d | g2 f d2 B | G B d g a g | f2 d G3 | d d g a b a | g2 f d3 | B d f g f d | G3 G3 | d2 g d2 B | G B d f2 d | g a b a g f | d3 B3 | G G B d d f | g2 a g2 f | d B G B d f | G6",
        // 号角在底下长长地吹 G 与 D（两小节一口气）
        hold: "!bend!G,,6 | G,,3 z3 | !bend!D,6 | D,3 z3 | !bend!G,,6 | G,,3 z3 | !bend!G,6 | !fall!D,3 z3 | !bend!G,,6 | G,,3 z3 | !bend!D,6 | D,3 z3 | !bend!G,,6 | G,,3 z3 | !bend!D,6 | !fall!G,,3 z3",
      },
    },
    B: {
      bars: 8,
      chords: "G5 | G5 | G5 | G5 | G5 | G5 | G5 | G5",
      lines: {
        hb: "!bend!G,6 | B,3 D3 | !bend!G6 | F3 !fall!D3 | z6 | z6 | !bend!D6 | !fall!G,6",
        ja: "z6 | z6 | z6 | z6 | G B d g f d | g2 f d2 B | d d g a g f | G6",
      },
    },
    coda: {
      bars: 2,
      chords: "G5 | G5",
      lines: { hc: "!bend!G,6 | !fall!G,,3 z3" },
    },
  },
  forms: [
    [
      { s: "intro", play: "hc:buren yemcen.intro sisa.intro pad", dyn: 0.62, tempo: 0.8 },
      { s: "A", play: "jh:mukun yemcen.a low pad", dyn: 0.66 },
      { s: "A", play: "jh:mukun hold:buren yemcen.a sisa.a low pad", dyn: 0.68 },
      { s: "B", play: "hb:buren ja:mukun yemcen.b sisa.b low pad", dyn: 0.72, tempo: 1.12 },
      { s: "B", play: "hb:buren ja:mukun yemcen.c sisa.c low pad", dyn: 0.76, tempo: 1.25 },
      { s: "coda", play: "hc:buren yemcen.coda sisa.coda low", dyn: 0.76, tempo: 1.25, rit: 0.8 },
    ],
    [
      { s: "A", play: "jh:mukun hold:buren yemcen.a sisa.a low pad", dyn: 0.66 },
      { s: "B", play: "hb:buren ja:mukun yemcen.b sisa.b low pad", dyn: 0.72, tempo: 1.12 },
      { s: "B", play: "hb:buren ja:mukun yemcen.c sisa.c low pad", dyn: 0.76, tempo: 1.25 },
      { s: "A", play: "jh:mukun yemcen.a sisa.a low pad", dyn: 0.68 },
      { s: "coda", play: "hc:buren yemcen.coda sisa.coda low", dyn: 0.76, tempo: 1.25, rit: 0.8 },
    ],
  ],
  rest: [10, 18],
  level: 1.2,
};
