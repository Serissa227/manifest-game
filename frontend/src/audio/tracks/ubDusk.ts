// 《傍晚回家的路》：养成篇的平时曲——傍晚回家（不分文化：功课做完、太阳落到海里，沿着码头与小巷走回家，远处的钟敲晚课）。旋律原创。
// 降 E 大调，6/8 拍（每分钟 96 个四分音符，附点四分音符一拍 64：慢慢走的步子），暖、有一点点想家：
// - 引子：远处的钟敲两下，竖琴分解和弦，弦乐的长音；
// - A：圆号唱主题——开头就是养成篇的成长动机（降B → 降E → F → G：5 → 1 → 2 → 3），一句一句往家里走；
// - A′：小提琴组接着唱第二句（往上爬到高音降 E 再落回来），大提琴组走低音；
// - B：双簧管在 C 小调一侧唱一段想家的旋律（G 大三和弦的还原 B、F7 的还原 A），落在降 B 上，等着回到主调；
// - 最后一遍圆号与小提琴一起唱 A′，尾声钟再敲一下。
// 管弦版：圆号、小提琴、双簧管、大提琴、竖琴与管钟，弦乐的和弦长音很轻。
import type { TrackDef } from "../score";

export const UB_DUSK: TrackDef = {
  id: "ub_dusk",
  title: { zh: "傍晚回家的路" },
  qpm: 96,
  meter: [6, 8],
  key: "Eb major",
  level: 1.06,
  voices: {
    horn: { inst: "horn", gain: 0.5, pan: -0.16, reverb: 0.4 },
    vns: { inst: "violins", gain: 0.46, pan: -0.3, reverb: 0.36 },
    oboe: { inst: "reed", gain: 0.44, pan: 0.06, reverb: 0.34 },
    vcs: { inst: "celli", gain: 0.42, pan: 0.26, reverb: 0.3 },
    hp: { inst: "harp", gain: 0.32, pan: -0.36, reverb: 0.38, pattern: { kind: "arp", low: 51, steps: "1 5 8 10 8 5", ring: 2 } },
    bell: { inst: "bell", gain: 0.26, pan: 0.3, reverb: 0.56 },
    pad: { inst: "strings", gain: 0.14, pan: 0.18, reverb: 0.42, pattern: { kind: "pad", low: 55, high: 70, size: 3 } },
    pz: { inst: "pizz", gain: 0.22, pan: 0.08, reverb: 0.16, pattern: { kind: "arp", low: 39, steps: "1 . . 5, . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "Eb | Ab | Eb | Bb",
      lines: { bell: "E6 | z6 | B,6 | z6" },
    },
    A: {
      bars: 8,
      chords: "Eb | Eb | Ab | Eb*3 Bb*3 | Cm | Fm | Bb | Eb",
      lines: {
        // 成长动机：降B → 降E → F → G
        mel: "B,3 E2 F | G6 | c3 B2 A | G3 F3 | G3 c2 B | A3 F3 | F2 A G2 F | E6",
        ab: "E,6 | G,6 | A,,6 | E,3 B,,3 | C,6 | F,6 | B,,6 | E,6",
      },
    },
    A2: {
      bars: 8,
      chords: "Eb | Gm | Ab | Bb | Cm | Ab | Bb | Eb",
      lines: {
        mel2: "B,3 E2 F | G3 B2 G | c3 e2 d | B6 | c3 G2 c | e3 c2 A | G2 F E2 D | E6",
        ab2: "E,6 | G,6 | A,,6 | B,,6 | C,6 | A,,6 | B,,6 | E,6",
      },
    },
    B: {
      bars: 8,
      chords: "Cm | Fm | G | Cm | Ab | Eb | F7 | Bb",
      lines: {
        bm: "G3 A2 G | A3 c2 A | =B3 d2 B | c6 | e3 d2 c | B3 G2 E | F3 =A2 c | B6",
        bb: "C,3 G,,3 | F,,3 C,3 | G,,3 D,3 | C,6 | A,,3 E,3 | E,3 B,,3 | F,,3 C,3 | B,,6",
      },
    },
    coda: {
      bars: 4,
      chords: "Ab | Eb | Bb | Eb",
      lines: {
        end: "c3 B2 A | G3 E3 | F2 G A2 F | E6",
        endb: "A,,6 | E,6 | B,,6 | E,6",
        bell: "z6 | z6 | z6 | E6",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "bell:bell hp pad", dyn: 0.5, to: 0.56 },
      { s: "A", play: "mel:horn ab:vcs hp pz", dyn: 0.6 },
      { s: "A2", play: "mel2:vns ab2:vcs hp pad pz", dyn: 0.64 },
      { s: "B", play: "bm:oboe bb:vcs hp pad", dyn: 0.6 },
      { s: "A", play: "mel:vns ab:vcs hp pad", dyn: 0.62 },
      { s: "A2", play: "mel2:vns mel2:horn ab2:vcs hp pad pz", dyn: 0.68, to: 0.64 },
      { s: "coda", play: "end:horn endb:vcs bell:bell hp pad", dyn: 0.58, to: 0.42, rit: 0.84 },
    ],
    [
      { s: "intro", play: "bell:bell hp", dyn: 0.5 },
      { s: "A", play: "mel:oboe ab:vcs hp pz", dyn: 0.58 },
      { s: "A2", play: "mel2:horn ab2:vcs hp pad pz", dyn: 0.62 },
      { s: "B", play: "bm:vns bb:vcs hp pad", dyn: 0.6 },
      { s: "B", play: "bm:oboe bb:vcs hp pad pz", dyn: 0.62 },
      { s: "A2", play: "mel2:vns mel2:horn ab2:vcs hp pad pz", dyn: 0.68, to: 0.64 },
      { s: "coda", play: "end:horn endb:vcs bell:bell hp pad", dyn: 0.58, to: 0.42, rit: 0.84 },
    ],
  ],
  rest: [10, 16],
};
