// 《斯海尔德河的集市》：低地国家的港口（安特卫普、布鲁日、米德尔堡、阿姆斯特丹……钟楼下的集市与节庆）。
// 地方特色第二阶段（北欧）：地方乐器领奏（复古合成版的衬底用合成的持续音与大提琴组）。
// G 混合利底亚（还原 F：风笛的“双主音”——G 的分解与 F 的分解轮流，下面的持续音一直是 G），4/4（每分钟 120 拍），农民节庆的轮舞步子：
// - 引子：钟楼的排钟（beiaard）奏整点前的 voorslag（一串快的下行），报时的大钟敲两下，隆默尔罐“轰——嗯”地跟进来；
// - A：风笛（doedelzak）领奏，持续音管 G2–G3 一直嗡着，重复的音靠倚音切开；隆默尔罐踩着步子；
// - B：克鲁姆管的三声部（高、中、低）奏一段文艺复兴的轮舞（苏萨托在安特卫普印的那种 ronde：二分音符、四分音符一步一步走）；
// - A′：风笛与低八度的克鲁姆管一起，雇佣兵的长鼓加进来；B′：排钟在高处奏轮舞，克鲁姆管奏中低声部；
// - 尾声：风笛收在主音上，报时的大钟一响。
// 和声：风笛与持续音的段落只有空五度（G5），克鲁姆管的轮舞用文艺复兴的三和弦（这一种音乐本来就有）。
import type { TrackDef } from "../score";

export const PORT_FLANDERS: TrackDef = {
  id: "port_flanders",
  title: { zh: "斯海尔德河的集市", en: "Kermis on the Scheldt" },
  qpm: 120,
  meter: [4, 4],
  key: "G mixolydian",
  voices: {
    pipe: { inst: "bagpipe", gain: 0.5, pan: -0.12, reverb: 0.24 },
    drones: { inst: "pipe_drone", gain: 0.42, pan: -0.12, reverb: 0.26, pattern: { kind: "drone", notes: [43, 55] } },
    crum1: { inst: "crumhorn", gain: 0.46, pan: 0.16, reverb: 0.28 },
    crum2: { inst: "crumhorn", gain: 0.38, pan: 0.3, reverb: 0.28 },
    crum3: { inst: "crumhorn", gain: 0.42, pan: 0.06, reverb: 0.26 },
    bells: { inst: "beiaard", gain: 0.4, pan: 0.32, reverb: 0.5 },
    hour: { inst: "beiaard", gain: 0.5, pan: 0.22, reverb: 0.6 },
    rommel: {
      inst: "perc",
      gain: 0.32,
      pan: -0.26,
      reverb: 0.24,
      pattern: {
        a: { kind: "drum", steps: "R...u.R.R...u.u.", hits: { R: ["rommelpot", 0.85], u: ["rommelpot_up", 0.55] } },
        intro: { kind: "drum", steps: "................R...u.R.R...uuuu", hits: { R: ["rommelpot", 0.8], u: ["rommelpot_up", 0.5] } },
      },
    },
    trom: {
      inst: "perc",
      gain: 0.26,
      pan: 0.08,
      reverb: 0.3,
      pattern: {
        a: { kind: "drum", steps: "T.r.T.rrT.r.T.r.", hits: { T: ["trommel", 0.8], r: ["trommel_rim", 0.45] } },
        coda: { kind: "drum", steps: "T.r.T.r.T.......", hits: { T: ["trommel", 0.9], r: ["trommel_rim", 0.5] } },
      },
    },
    // 衬底（合成）：空五度 / 三和弦的持续音、大提琴组的长音
    pad: { inst: "drone", gain: 0.14, pan: -0.2, reverb: 0.4, pattern: { kind: "pad", low: 52, high: 71, size: 2 } },
    low: { inst: "celli", gain: 0.16, pan: 0.14, reverb: 0.26, pattern: { kind: "arp", low: 43, steps: "1 . . . . . . .", ring: 8 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "G5 | G5 | G5 | G5",
      lines: {
        // 整点前的 voorslag：排钟的一串快音
        voor: "g/2d/2B/2d/2 g/2b/2a/2g/2 d'2 b2 | a/2g/2f/2e/2 d/2e/2f/2g/2 a2 d2 | g/2a/2b/2a/2 g/2f/2e/2f/2 g4 | z8",
        // 报时的大钟
        hour: "z8 | z8 | z8 | G,4 G,4",
      },
    },
    A: {
      bars: 8,
      chords: "G5 | G5 | G5 | G5 | G5 | G5 | G5 | G5",
      lines: {
        // 风笛：G 的分解与 F 的分解轮流（双主音），倚音切开重复的音
        mel: "G2 B d2 {e}d B2 | d2 g2 {a}g2 f d | c2 A2 F2 {g}F A | c2 f2 e2 d c | B2 G2 {a}G B d2 | g2 {a}g f g2 a2 | f2 d2 c2 A F | G8",
      },
    },
    B: {
      bars: 8,
      chords: "C | G | Am | D | C | G | Am D | G",
      lines: {
        // 克鲁姆管的三声部轮舞
        bmel: "e4 d2 c2 | d2 B2 G4 | c4 B2 A2 | A2 ^F2 D4 | e4 f2 e2 | d2 B2 d4 | c2 A2 B2 ^F2 | G8",
        balto: "c4 B2 A2 | B2 G2 D4 | A4 G2 E2 | ^F2 D2 A,4 | c4 A2 G2 | B2 G2 B4 | A2 E2 D2 D2 | D8",
        bbass: "C,4 E,4 | G,4 D,4 | A,4 E,4 | D,4 ^F,4 | C,4 G,4 | G,4 B,4 | A,4 D,4 | G,8",
      },
    },
    coda: {
      bars: 2,
      chords: "G5 | G5",
      lines: {
        end: "d2 {e}d B c2 A2 | G8",
        hour: "z8 | G,8",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "voor:bells hour:hour rommel.intro pad", dyn: 0.62, to: 0.7 },
      { s: "A", play: "mel:pipe drones rommel low pad", dyn: 0.68 },
      { s: "B", play: "bmel:crum1 balto:crum2 bbass:crum3 low pad", dyn: 0.66 },
      { s: "A", play: "mel:pipe mel:crum1-12 drones rommel trom low pad", dyn: 0.72 },
      { s: "B", play: "bmel:bells+12 balto:crum2 bbass:crum3 low pad", dyn: 0.64 },
      { s: "A", play: "mel:pipe mel:crum1-12 drones rommel trom low pad", dyn: 0.76 },
      { s: "coda", play: "end:pipe hour:hour drones trom.coda low", dyn: 0.74, rit: 0.9 },
    ],
    [
      { s: "A", play: "mel:crum1 rommel low pad", dyn: 0.64 },
      { s: "B", play: "bmel:bells+12 balto:crum2 bbass:crum3 low pad", dyn: 0.64 },
      { s: "A", play: "mel:pipe mel:crum1-12 drones rommel trom low pad", dyn: 0.74 },
      { s: "coda", play: "end:pipe hour:hour drones trom.coda low", dyn: 0.72, rit: 0.9 },
    ],
  ],
  rest: [10, 18],
  level: 1.45,
};
