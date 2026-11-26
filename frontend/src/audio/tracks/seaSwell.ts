// 《长浪》：远洋上的涌——几天看不见陆地，船被一道道又长又缓的浪托起来、放下去（大西洋、印度洋、太平洋的远洋都轮得到它）。
// 第九批 A01（2026-11-11）新写，旋律原创。G 大调，9/8 拍（每分钟 84 个四分音符：附点四分音符一拍 56，一小节三拍，一起一落正好一道浪）：
// - 引子：竖琴的分解和弦与弦乐的长音，像船身慢慢抬起来；
// - A：大提琴组在中音区唱主题（D → G → B 一级级托上去，再缓缓落回来），竖琴托着；
// - B：转到 E 小调一侧，双簧管唱一段更密的旋律（风紧了一点），最后停在属和弦上等着回来；
// - A′：小提琴组高八度再唱主题，圆号在下面走一条长音的对旋律；尾声渐慢，收在主和弦上。
// 管弦版：大提琴、小提琴、双簧管、圆号、竖琴，弦乐的和弦长音与低音提琴的拨奏。
import type { TrackDef } from "../score";

const MEL = "D3 G3 B3 | B2 A G3 E3 | E3 G3 c3 | B2 c A6 | D3 G3 B3 | d2 c B3 F3 | E3 G3 A3 | G9";

export const SEA_SWELL: TrackDef = {
  id: "sea_swell",
  title: { zh: "长浪" },
  qpm: 84,
  meter: [9, 8],
  key: "G major",
  level: 1.23,
  hall: true,
  voices: {
    vns: { inst: "violins", gain: 0.5, pan: -0.28, reverb: 0.38 },
    vcs: { inst: "celli", gain: 0.5, pan: 0.24, reverb: 0.32 },
    ob: { inst: "reed", gain: 0.42, pan: 0.04, reverb: 0.34 },
    horn: { inst: "horns", gain: 0.4, pan: -0.16, reverb: 0.42 },
    hp: { inst: "harp", gain: 0.3, pan: -0.38, reverb: 0.4, pattern: { kind: "arp", low: 43, steps: "1 5 8 10 8 5 8 10 8", ring: 2 } },
    pad: { inst: "strings", gain: 0.16, pan: 0.14, reverb: 0.44, pattern: { kind: "pad", low: 55, high: 72, size: 3 } },
    pz: { inst: "pizz", gain: 0.24, pan: 0.1, reverb: 0.18, pattern: { kind: "arp", low: 31, steps: "1 . . 5, . . 1 . .", ring: 3 } },
  },
  sections: {
    intro: { bars: 2, chords: "G | D" },
    A: {
      bars: 8,
      chords: "G | Em | C | D | G | Bm | C*6 D*3 | G",
      lines: { mel: MEL },
    },
    B: {
      bars: 8,
      chords: "Em | Am | D | G | C | Am | D | D",
      lines: {
        bmel: "e3 d2 B e3 | c3 B2 A c3 | d3 f2 e d3 | B6 d3 | e3 g2 e c3 | A3 c2 B A3 | F3 A3 d3 | d9",
      },
    },
    A2: {
      bars: 8,
      chords: "G | Em | C | D | G | Bm | C*6 D*3 | G",
      lines: {
        mel: MEL,
        // 圆号的对旋律：长音，与主题反向或斜向
        cnt: "B,9 | G,6 B,3 | C6 E3 | D6 F3 | B,9 | B,6 F3 | C6 D3 | D9",
      },
    },
    coda: {
      bars: 3,
      chords: "C | D | G",
      lines: { end: "e3 c3 G3 | A3 F3 A3 | G9" },
    },
  },
  forms: [
    [
      { s: "intro", play: "hp pad", dyn: 0.46, to: 0.56 },
      { s: "A", play: "mel:vcs-12 hp pz", dyn: 0.6 },
      { s: "B", play: "bmel:ob hp pad pz", dyn: 0.62, to: 0.66 },
      { s: "A2", play: "mel:vns+12 cnt:horn hp pad pz", dyn: 0.7, to: 0.66 },
      { s: "coda", play: "end:vns hp pad pz", dyn: 0.58, to: 0.4, rit: 0.82 },
    ],
    [
      { s: "intro", play: "hp pad", dyn: 0.46, to: 0.54 },
      { s: "A", play: "mel:ob hp pz", dyn: 0.58 },
      { s: "A2", play: "mel:vns cnt:horn hp pad pz", dyn: 0.64 },
      { s: "B", play: "bmel:vcs-12 hp pad pz", dyn: 0.62, to: 0.66 },
      { s: "A2", play: "mel:vns+12 mel:vcs-12 cnt:horn hp pad pz", dyn: 0.7, to: 0.66 },
      { s: "coda", play: "end:vns hp pad pz", dyn: 0.58, to: 0.4, rit: 0.82 },
    ],
  ],
  rest: [25, 45],
};
