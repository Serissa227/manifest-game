// 《信风带》：大西洋的远洋（南北大西洋的信风带、马尾藻海、湾流、好望角外海、拉普拉塔与巴塔哥尼亚外海）。
// 第九批 A01（2026-11-11）新写：这一大片海原来借伊比利亚沿岸的《圣文森特角的帆》，离了岸几十天，该有一首自己的。旋律原创。
// 降 B 大调，6/8 拍（每分钟 100 个四分音符，附点四分音符一拍约 67）：信风稳稳地从船尾吹来，一路顺风的宽旋律——
// - 引子：竖琴的分解和弦像船头的水花，圆号远远吹出起帆的动机（F → 降B → D：五度上去再上三度）；
// - A：小提琴组唱主题，开头就是那个动机，一句往上、一句落回来；
// - A′：答句爬得更高（到高音降 B），大提琴组在下面走一条反向的对旋律；
// - B：转到 G 小调一侧，圆号唱“长夜的值更”——宽、稳，借 C 大三和弦的还原 E 推到属和弦，再回主调；
// - 再现时长笛高八度跟着小提琴，沙锤轻轻地摇；尾声渐慢，收在主和弦上。
// 管弦版：小提琴组、圆号、长笛、大提琴、竖琴，弦乐的和弦长音与低音提琴的拨奏。
import type { TrackDef } from "../score";

export const SEA_ATLANTIC: TrackDef = {
  id: "sea_atlantic",
  title: { zh: "信风带" },
  qpm: 100,
  meter: [6, 8],
  key: "Bb major",
  level: 1.04,
  hall: true,
  voices: {
    vns: { inst: "violins", gain: 0.52, pan: -0.28, reverb: 0.36 },
    horn: { inst: "horns", gain: 0.5, pan: -0.14, reverb: 0.42 },
    fl: { inst: "flute", gain: 0.34, pan: 0.06, reverb: 0.36 },
    vcs: { inst: "celli", gain: 0.44, pan: 0.26, reverb: 0.3 },
    hp: { inst: "harp", gain: 0.3, pan: -0.38, reverb: 0.38, pattern: { kind: "arp", low: 46, steps: "1 5 8 10 8 5", ring: 2 } },
    pad: { inst: "strings", gain: 0.15, pan: 0.16, reverb: 0.42, pattern: { kind: "pad", low: 55, high: 72, size: 3 } },
    pz: { inst: "pizz", gain: 0.24, pan: 0.1, reverb: 0.16, pattern: { kind: "arp", low: 34, steps: "1 . . 5, . .", ring: 2 } },
    shk: { inst: "perc", gain: 0.2, pan: 0.2, reverb: 0.24, pattern: { kind: "drum", steps: "s..s.s", hits: { s: ["shaker", 0.3] } } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "Bb | Eb | Bb | F",
      // 起帆的动机：F → 降B → D
      lines: { call: "z6 | z3 F2 B | d6 | c6" },
    },
    A: {
      bars: 8,
      chords: "Bb | Bb | Eb | Bb | Gm | Cm | F | Bb",
      lines: {
        mel: "F3 B2 c | d3 f2 d | e3 g2 e | d3 B3 | g3 f2 d | e2 d c2 e | d2 c A2 c | B6",
      },
    },
    A2: {
      bars: 8,
      chords: "Bb | Dm | Eb | F | Gm | Eb | F | Bb",
      lines: {
        mel2: "F3 B2 c | d3 a2 f | g3 b2 g | a2 g f2 c | d3 g2 b | g3 e2 g | f2 e d2 c | B6",
        // 大提琴的对旋律：与主题反向
        cnt: "B,3 D3 | F3 D3 | E3 G3 | F3 A,3 | B,3 D3 | E3 B,3 | A,3 C3 | B,6",
      },
    },
    B: {
      bars: 8,
      // C 大三和弦（还原 E）是属的属
      chords: "Gm | Dm | Eb | Bb | Cm | Gm | C | F",
      lines: {
        bmel: "G3 B2 d | d3 A3 | G3 B2 e | d2 c B3 | c3 e2 d | B3 G3 | c3 =e2 d | c6",
        bb: "G,6 | D,6 | E,6 | B,,6 | C,6 | G,,6 | C,6 | F,,6",
      },
    },
    coda: {
      bars: 4,
      chords: "Eb | Bb | F | Bb",
      lines: { end: "g3 e2 c | d3 B2 F | A2 B c2 A | B6" },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:horn hp pad", dyn: 0.5, to: 0.58 },
      { s: "A", play: "mel:vns hp pz", dyn: 0.62 },
      { s: "A2", play: "mel2:vns cnt:vcs hp pad pz", dyn: 0.66 },
      { s: "B", play: "bmel:horn bb:vcs hp pad", dyn: 0.62 },
      { s: "A", play: "mel:vns mel:fl+12 hp pad pz shk", dyn: 0.68 },
      { s: "A2", play: "mel2:vns mel2:horn-12 cnt:vcs hp pad pz shk", dyn: 0.72, to: 0.68 },
      { s: "coda", play: "end:vns hp pad pz", dyn: 0.6, to: 0.42, rit: 0.84 },
    ],
    [
      { s: "intro", play: "call:horn hp", dyn: 0.5, to: 0.56 },
      { s: "A", play: "mel:fl hp pz", dyn: 0.6 },
      { s: "B", play: "bmel:vcs hp pad pz", dyn: 0.62 },
      { s: "A2", play: "mel2:vns cnt:vcs hp pad pz", dyn: 0.66 },
      { s: "B", play: "bmel:horn bb:vcs hp pad shk", dyn: 0.66 },
      { s: "A2", play: "mel2:vns mel2:horn-12 mel2:fl cnt:vcs hp pad pz shk", dyn: 0.72, to: 0.68 },
      { s: "coda", play: "end:vns hp pad pz", dyn: 0.6, to: 0.42, rit: 0.84 },
    ],
  ],
  rest: [25, 45],
};
