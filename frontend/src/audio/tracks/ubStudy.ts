// 《灯下的功课》：养成篇的平时曲——读书与练习（不分文化：抄书、背航路、练琴、算账，一天的功课）。旋律原创。
// C 大调，4/4（每分钟 104 拍），像一首给初学者的二声部小曲：一个声部唱主题，另一个声部一步一步地走低音。
// - 引子：羽管键琴像练指法那样把音阶上下弹一遍；
// - A：长笛唱主题——开头四个音就是养成篇的成长动机（G → C → D → E：5 → 1 → 2 → 3），后面接一串八分音符（像在背书），
//   羽管键琴在下面走分解的低音；再一遍竖笛在下方三度跟着（第四小节换成六度，不与 B 撞在一起），大提琴走低音；
// - B：转到 A 小调一侧，提琴唱一段想不通、慢慢想的旋律，羽管键琴分解和弦；第七小节借 D7（升 F）推回 G——想通了；
// - A″：全体，尾声落回 C。
// 管弦版：长笛、单簧管（代替竖笛）、大管与竖琴（代替羽管键琴的低音）、小提琴与大提琴，弦乐的和弦长音很轻。
import type { TrackDef } from "../score";

export const UB_STUDY: TrackDef = {
  id: "ub_study",
  title: { zh: "灯下的功课" },
  qpm: 104,
  meter: [4, 4],
  key: "C major",
  level: 1.06,
  voices: {
    flute: { inst: "flute", gain: 0.56, pan: -0.1, reverb: 0.3 },
    rec: { inst: "recorder", gain: 0.46, pan: 0.12, reverb: 0.3 },
    fid: { inst: "fiddle", gain: 0.5, pan: 0.16, reverb: 0.32 },
    cello: { inst: "cello", gain: 0.44, pan: 0.24, reverb: 0.26 },
    hc: { inst: "harpsichord", gain: 0.4, pan: -0.24, reverb: 0.24 },
    hcp: { inst: "harpsichord", gain: 0.22, pan: -0.28, reverb: 0.24, pattern: { kind: "arp", low: 48, steps: "1 5 8 5 10 8 5 8", ring: 2 } },
    pad: { inst: "strings", gain: 0.14, pan: 0.2, reverb: 0.4, pattern: { kind: "pad", low: 55, high: 69, size: 3 } },
    pz: { inst: "pizz", gain: 0.24, pan: 0.06, reverb: 0.16, pattern: { kind: "arp", low: 36, steps: "1 . . . 5 . . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "C | G*4 C*4",
      lines: { run: "C/2D/2E/2F/2 G/2A/2B/2c/2 d/2e/2f/2g/2 c2 | B/2A/2G/2F/2 E/2D/2C/2B,/2 C4" },
    },
    A: {
      bars: 8,
      chords: "C | F | G | G | Am | Dm | G | C",
      lines: {
        // 成长动机 G → C → D → E，接一串八分音符
        mel: "G2 c d e2 g2 | f e d c A2 c2 | B2 d2 g3 f | e2 d c d4 | c2 e d c B A2 | d f e d c B A2 | G A B c d2 B2 | c6 z2",
        // 下方三度（第三、四小节改成 G、B 一带，不与旋律撞在一起）
        alt: "E2 A B c2 e2 | d c B A F2 A2 | G2 B2 d3 d | G2 B A B4 | A2 c B A G E2 | B d c B A G F2 | E F G A B2 G2 | E6 z2",
        cnt: "C,2 E,2 G,2 E,2 | F,2 A,2 C2 A,2 | G,2 B,2 D2 B,2 | G,2 F,2 E,2 D,2 | A,2 C2 E2 C2 | D,2 F,2 A,2 F,2 | G,2 A,2 B,2 G,2 | C,2 G,2 C,4",
      },
    },
    B: {
      bars: 8,
      chords: "Am | Em | F | C | Dm | Am | D7 | G",
      lines: {
        bm: "e3 d c2 B2 | B3 A G2 E2 | A3 B c2 A2 | G6 z2 | f3 e d2 A2 | e3 d c2 A2 | d2 c B A2 ^F2 | G6 z2",
        bb: "A,4 E,4 | E,4 B,,4 | F,4 C,4 | C,4 G,4 | D,4 A,4 | A,4 E,4 | D,4 ^F,4 | G,4 D,4",
      },
    },
    coda: {
      bars: 2,
      chords: "F*4 G*4 | C",
      lines: { end: "f2 e2 d2 B2 | c8", endb: "F,4 G,4 | C,8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "run:hc pad", dyn: 0.52, to: 0.58 },
      { s: "A", play: "mel:flute cnt:hc pz", dyn: 0.6 },
      { s: "A", play: "mel:flute alt:rec cnt:cello pad pz", dyn: 0.64 },
      { s: "B", play: "bm:fid bb:cello hcp pad", dyn: 0.6 },
      { s: "A", play: "mel:flute alt:rec cnt:hc cnt:cello pad pz", dyn: 0.66 },
      { s: "coda", play: "end:flute endb:cello pad", dyn: 0.6, to: 0.44, rit: 0.86 },
    ],
    [
      { s: "intro", play: "run:hc", dyn: 0.52 },
      { s: "A", play: "mel:rec cnt:hc pz", dyn: 0.58 },
      { s: "B", play: "bm:flute bb:cello hcp pad", dyn: 0.6 },
      { s: "A", play: "mel:fid alt:rec cnt:cello pad pz", dyn: 0.62 },
      { s: "B", play: "bm:fid bb:cello hcp pad pz", dyn: 0.62 },
      { s: "A", play: "mel:flute alt:rec cnt:hc cnt:cello pad pz", dyn: 0.66 },
      { s: "coda", play: "end:flute endb:cello pad", dyn: 0.6, to: 0.44, rit: 0.86 },
    ],
  ],
  rest: [8, 14],
};
