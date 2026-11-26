// 《泰晤士河的号笛舞》：英格兰的港口（伦敦的码头、布里斯托尔、普利茅斯、赫尔……教堂的鸣钟与酒馆门前的舞）。
// 地方特色第二阶段（北欧）：地方乐器领奏（复古合成版的衬底用合成的弦乐群与大提琴组）。
// D 混合利底亚（还原 C：英格兰民间舞曲常见的调式），3/2 拍的号笛舞（hornpipe：一小节三个二分音符，“四分—二分—四分”的切分，
// 句尾是两个长音加一拍空），每分钟 168 个四分音符（二分音符 84）：
// - 引子：教堂塔楼的六口钟“鸣圆”（rounds：从最高的钟依次敲到最低的 B A G F♯ E D），再变两次序（plain hunt 的头四个“换”，change ringing）；
// - A：三孔笛与小鼓（pipe and tabor，一人同奏）吹号笛舞，班多拉琴弹低音；
// - B：雷贝克琴（乡村提琴手）拉第二段，班多拉琴扫弦；
// - A′、B′：三孔笛与雷贝克琴一起（雷贝克低八度的异音），小鼓加花；尾声：笛子收住，塔楼的钟再鸣一轮。
// 和声用英格兰民间舞曲的调式和弦（D、C、G，还原 C 的 C 大三和弦是混合利底亚的颜色）。
import type { TrackDef } from "../score";

export const PORT_ENGLAND: TrackDef = {
  id: "port_england",
  title: { zh: "泰晤士河的号笛舞", en: "Hornpipe on the Thames" },
  qpm: 168,
  meter: [3, 2],
  key: "D mixolydian",
  voices: {
    pipe: { inst: "tabor_pipe", gain: 0.5, pan: -0.14, reverb: 0.26 },
    rebeck: { inst: "rebeck", gain: 0.48, pan: 0.18, reverb: 0.26 },
    bandora: {
      inst: "bandora",
      gain: 0.42,
      pan: 0.26,
      reverb: 0.22,
      pattern: {
        a: { kind: "arp", low: 38, steps: "1 . . . 5 . . . 8 . 5 .", ring: 2 },
        s: { kind: "strum", low: 45, high: 64, steps: "D . . . d . D . . . u .", spread: 0.014 },
      },
    },
    bells: { inst: "beiaard", gain: 0.34, pan: 0.3, reverb: 0.56 },
    tabor: {
      inst: "perc",
      gain: 0.3,
      pan: -0.2,
      reverb: 0.24,
      pattern: {
        a: { kind: "drum", steps: "T..rT.r.F.r.", hits: { T: ["taborin", 0.8], F: ["taborin_flam", 0.85], r: ["taborin_rim", 0.45] } },
        b: { kind: "drum", steps: "T.rrT.r.F.rrT..rT.r.F.T.", hits: { T: ["taborin", 0.8], F: ["taborin_flam", 0.9], r: ["taborin_rim", 0.45] } },
        coda: { kind: "drum", steps: "F...T...T...F...........", hits: { T: ["taborin", 0.85], F: ["taborin_flam", 0.95] } },
      },
    },
    // 衬底（合成）：弦乐群的和弦长音、大提琴组的根音
    pad: { inst: "strings", gain: 0.2, pan: -0.16, reverb: 0.4, pattern: { kind: "pad", low: 52, high: 69, size: 3 } },
    low: { inst: "celli", gain: 0.2, pan: 0.12, reverb: 0.26, pattern: { kind: "arp", low: 38, steps: "1 . . . . . . . . . . .", ring: 12 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "D | D | D | D",
      lines: {
        // 六口钟：鸣圆两轮，再“换”四次（plain hunt：21 43 65 → 24 16 35 → 42 61 53 → 46 25 13）
        ring: "B A G F E D B A G F E D | B A G F E D B A G F E D | A B F G D E A F B D G E | F A D B E G F D A E B G",
      },
    },
    A: {
      bars: 8,
      chords: "D | C | D | D | G | D | C A | D",
      lines: {
        // 号笛舞：四分—二分—四分的切分，句尾两个长音加一拍空
        mel: "f2 a4 a2 g2 f2 | e2 c4 c2 d2 e2 | f2 a4 a2 b2 c'2 | d'4 a4 f4 | g2 b4 b2 a2 g2 | f2 a4 a2 g2 f2 | e2 c2 e2 g2 f2 e2 | d4 d4 z4",
      },
    },
    B: {
      bars: 8,
      chords: "D | C | D | C | D | G | C | D",
      lines: {
        bmel: "A2 d4 d2 e2 f2 | g2 e4 e2 f2 g2 | a2 f4 d2 e2 f2 | e4 c4 A4 | A2 d4 d2 e2 f2 | g2 b4 a2 g2 f2 | e2 g2 f2 e2 d2 c2 | d4 D4 z4",
      },
    },
    coda: {
      bars: 2,
      chords: "D | D",
      lines: {
        end: "a2 f4 e2 d2 c2 | d4 d4 z4",
        ring: "z12 | B A G F E D z6",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "ring:bells low", dyn: 0.62, to: 0.68 },
      { s: "A", play: "mel:pipe tabor bandora low pad", dyn: 0.68 },
      { s: "B", play: "bmel:rebeck bandora.s low pad", dyn: 0.66 },
      { s: "A", play: "mel:pipe mel:rebeck-12 tabor.b bandora low pad", dyn: 0.72 },
      { s: "B", play: "bmel:pipe+12 bmel:rebeck tabor bandora.s low pad", dyn: 0.74 },
      { s: "coda", play: "end:pipe ring:bells tabor.coda bandora low", dyn: 0.72, rit: 0.9 },
    ],
    [
      { s: "A", play: "mel:rebeck bandora low pad", dyn: 0.64 },
      { s: "B", play: "bmel:pipe+12 tabor bandora.s low pad", dyn: 0.68 },
      { s: "A", play: "mel:pipe mel:rebeck-12 tabor.b bandora low pad", dyn: 0.74 },
      { s: "coda", play: "end:pipe ring:bells tabor.coda bandora low", dyn: 0.72, rit: 0.9 },
    ],
  ],
  rest: [10, 18],
  level: 1.08,
};
