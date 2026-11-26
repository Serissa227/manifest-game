// 《白海岸的钟声》：罗斯的港口（霍尔莫戈雷与北德维纳河口、诺夫哥罗德、伊万哥罗德……教堂的钟、集市与说唱人）。
// 地方特色第二阶段（北欧）：地方乐器领奏（复古合成版的衬底用合成的持续音与大提琴组）。
// A 小调（自然小调；民歌的“游移调式”——第二段转到 C 大调一侧再回来），2/4 拍，每分钟 126 拍：
// - 钟声（zvon）：报时的大钟一下一下慢慢地敲，然后中钟（podzvonnye）与几口小钟（zazvonnye）一起拉起来，敲出反复的节奏型（trezvon）。
//   罗斯的钟不按和弦配：几口钟只取几个固定的音——大钟 A，中钟 B、D、E，小钟 E、D、B（偶尔 A），彼此是二度与四度，合起来不成大小三和弦；
//   trezvon 靠节奏型取胜：小钟一小节八个十六分音符按 3 + 3 + 2 分组反复，中钟落在反拍上；
// - 长歌（protyazhnaya，慢下来）：扎列伊卡（牛角牧笛）唱一条拖得很长的旋律，古多克在下面拉同一条旋律的另一个样子（异音，podgoloski），
//   古多克的空弦一直嗡着；
// - 舞曲（plyasovaya）：一段八小节的短曲反复变奏——古多克、扎列伊卡、古斯里琴轮流领，木勺、布本鼓、木片响板一层层加进来；
//   中间转到 C 大调一侧唱一段（游移调式），再回到 A 小调；尾声：舞曲收住，钟声再起。
// 和声：长歌只有持续音（A–E）；舞曲里古斯里琴扫的是民间的调式和弦（Am、C、G，没有西洋的属七进行）。
import type { TrackDef } from "../score";

export const PORT_RUSSIA: TrackDef = {
  id: "port_russia",
  title: { zh: "白海岸的钟声", en: "Bells of the White Sea Coast" },
  qpm: 126,
  meter: [2, 4],
  key: "A minor",
  voices: {
    bigbell: { inst: "kolokol", gain: 0.5, pan: 0.08, reverb: 0.6 },
    bells: { inst: "kolokol", gain: 0.24, pan: 0.3, reverb: 0.5 },
    // 中钟（podzvonnye）：在大钟与小钟之间，落在反拍上
    mbells: { inst: "kolokol", gain: 0.28, pan: -0.1, reverb: 0.55 },
    zhal: { inst: "zhaleika", gain: 0.48, pan: -0.16, reverb: 0.3 },
    gudok: { inst: "gudok", gain: 0.5, pan: 0.14, reverb: 0.26 },
    gdrone: { inst: "gudok", gain: 0.2, pan: 0.14, reverb: 0.3, pattern: { kind: "drone", notes: [57] } },
    gusli: {
      inst: "gusli",
      gain: 0.36,
      pan: 0.28,
      reverb: 0.3,
      pattern: {
        a: { kind: "strum", low: 52, high: 72, steps: "D u d u", spread: 0.012 },
        slow: { kind: "strum", low: 52, high: 72, steps: "D . . . . . . .", spread: 0.03 },
        end: { kind: "strum", low: 52, high: 72, steps: "D u d u D u d u D . . . . . . .", spread: 0.012 },
      },
    },
    lozhki: {
      inst: "perc",
      gain: 0.28,
      pan: -0.24,
      reverb: 0.22,
      pattern: {
        a: { kind: "drum", grid: 0.5, steps: "L.lLL.l.", hits: { L: ["lozhki", 0.8], l: ["lozhki", 0.45] } },
        b: { kind: "drum", grid: 0.5, steps: "L.lLR.l.L.lLR.R.", hits: { L: ["lozhki", 0.8], l: ["lozhki", 0.45], R: ["lozhki_roll", 0.7] } },
      },
    },
    buben: {
      inst: "perc",
      gain: 0.26,
      pan: 0.2,
      reverb: 0.26,
      pattern: {
        a: { kind: "drum", steps: "B.sbB.s.", hits: { B: ["buben", 0.75], b: ["buben", 0.45], s: ["buben_shake", 0.5] } },
        coda: { kind: "drum", steps: "B.s.B.s.B...s...", hits: { B: ["buben", 0.8], s: ["buben_shake", 0.55] } },
      },
    },
    tresh: { inst: "perc", gain: 0.22, pan: -0.32, reverb: 0.24, pattern: { kind: "drum", steps: "T.......T...s.s.", hits: { T: ["treshchotka", 0.75], s: ["treshchotka_short", 0.5] } } },
    // 衬底（合成）：持续音、大提琴组的根音
    pad: { inst: "drone", gain: 0.18, pan: -0.2, reverb: 0.4, pattern: { kind: "pad", low: 52, high: 69, size: 2 } },
    low: { inst: "celli", gain: 0.2, pan: 0.12, reverb: 0.26, pattern: { kind: "arp", low: 45, steps: "1 . . .", ring: 4 } },
  },
  sections: {
    zvon: {
      bars: 8,
      chords: "A5 | A5 | A5 | A5 | A5 | A5 | A5 | A5",
      lines: {
        // 报时的大钟，然后大钟落在每小节的第一拍
        big: "A,,4 | z4 | A,,4 | z4 | A,,4 | A,,4 | A,,4 | A,,2 A,,2",
        // 中钟：反拍上的 B、D（与大钟的 A、小钟的 E 只成二度与四度）
        mid: "z4 | z4 | z4 | z4 | z B, D B, | z B, D B, | z B, D E | B,2 E2",
        // 小钟的节奏型（trezvon）：E、D、B 三口钟，十六分音符按 3 + 3 + 2 分组反复，不是和弦的分解
        small: "z4 | z4 | z4 | z4 | e/2d/2B/2e/2d/2B/2e/2d/2 | e/2d/2B/2e/2d/2B/2e/2d/2 | a/2e/2d/2a/2e/2d/2e/2B/2 | e/2d/2B/2e/2 d2",
      },
    },
    song: {
      bars: 8,
      chords: "A5 | A5 | A5 | A5 | A5 | A5 | A5 | A5",
      lines: {
        // 长歌：扎列伊卡
        zline: "!bend!E2 A2 | (B c) (B A) | !vib!c4 | (B A) (G E) | A2 c2 | (e d) (c B) | !vib!A3 G | !fall!A4",
        // 古多克的异音
        gline: "E4 | B2 A2 | c2 B2 | A2 E2 | A4 | e2 c2 | B2 G2 | A4",
      },
    },
    A: {
      bars: 8,
      chords: "Am | Am | C | Am | G | Am | Am | G Am",
      lines: { dmel: "e/2e/2e/2d/2 c B | c/2d/2e/2c/2 A2 | e/2e/2e/2d/2 c B | A/2B/2c/2B/2 A2 | G/2A/2B/2c/2 d B | c/2B/2A/2G/2 E2 | A/2B/2c/2d/2 e c | B/2c/2B/2G/2 A2" },
    },
    B: {
      bars: 8,
      // 游移调式：转到 C 大调一侧，再回 A 小调
      chords: "C | G | C | G C | Am | Am | Am | G Am",
      lines: { bmel: "g/2g/2g/2e/2 c e | d/2e/2d/2c/2 G2 | g/2g/2g/2e/2 c e | d/2c/2B/2d/2 c2 | e/2f/2e/2d/2 c B | A/2B/2c/2A/2 E2 | e/2e/2e/2d/2 c B | B/2c/2B/2G/2 A2" },
    },
    coda: {
      bars: 4,
      chords: "A5 | A5 | A5 | A5",
      lines: {
        cend: "e/2e/2e/2d/2 c B | A2 E2 | A4 | z4",
        big: "z4 | z4 | A,,4 | A,,4",
        mid: "z4 | z4 | z B, D B, | E4",
        small: "z4 | z4 | e/2d/2B/2e/2d/2B/2e/2d/2 | e/2d/2B/2d/2 e2",
      },
    },
  },
  forms: [
    [
      { s: "zvon", play: "big:bigbell mid:mbells small:bells pad", dyn: 0.6, to: 0.7 },
      { s: "song", play: "zline:zhal gline:gudok gdrone gusli.slow low pad", dyn: 0.62, tempo: 0.6, rit: 0.56 },
      { s: "A", play: "dmel:gudok gusli lozhki low pad", dyn: 0.66 },
      { s: "A", play: "dmel:zhal dmel:gudok gusli lozhki buben low pad", dyn: 0.7 },
      { s: "B", play: "bmel:zhal gusli lozhki buben low pad", dyn: 0.7 },
      { s: "A", play: "dmel:zhal dmel:gudok gusli lozhki.b buben tresh low pad", dyn: 0.74 },
      { s: "B", play: "bmel:gusli bmel:gudok gusli lozhki.b buben tresh low pad", dyn: 0.74 },
      { s: "A", play: "dmel:zhal dmel:gudok-12 gusli lozhki.b buben tresh low pad", dyn: 0.78 },
      { s: "coda", play: "cend:zhal cend:gudok big:bigbell mid:mbells small:bells gusli.end buben.coda low", dyn: 0.76, rit: 0.86 },
    ],
    [
      { s: "song", play: "zline:zhal gline:gudok gdrone gusli.slow low pad", dyn: 0.6, tempo: 0.6, rit: 0.56 },
      { s: "A", play: "dmel:zhal gusli lozhki low pad", dyn: 0.66 },
      { s: "B", play: "bmel:gudok gusli lozhki buben low pad", dyn: 0.7 },
      { s: "A", play: "dmel:zhal dmel:gudok gusli lozhki.b buben tresh low pad", dyn: 0.74 },
      { s: "B", play: "bmel:zhal bmel:gudok-12 gusli lozhki.b buben tresh low pad", dyn: 0.76 },
      { s: "A", play: "dmel:zhal dmel:gudok gusli lozhki.b buben tresh low pad", dyn: 0.78 },
      { s: "coda", play: "cend:zhal cend:gudok big:bigbell mid:mbells small:bells gusli.end buben.coda low", dyn: 0.76, rit: 0.86 },
    ],
  ],
  rest: [10, 18],
  level: 0.98,
};
