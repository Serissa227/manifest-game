// 《商馆与凉廊》：意大利的港口（威尼斯的里亚尔托与德意志商馆、热那亚的商人凉廊、那不勒斯、安科纳……）。
// 第九批配乐·地方特色第二阶段：文艺复兴的意大利乐器领奏（复古合成版的衬底用合成的弦乐与拨奏低音，管弦版换成真的弦乐，都很轻）。
// G 混合利底亚（还原 F；终止前的升 F 是“临时的导音” musica ficta），4/4 拍，每分钟 108 拍；三种威尼斯的颜色：
// - 坎佐纳（canzona）：开头“长—短—短”的同音（G — G — G），短号先独自吹出主题，两小节后低音萨克布在下面两个八度隔开地模仿；
// - 分开的合唱（cori spezzati，圣马可教堂两边各一个唱诗台）：第一合唱是短号 + 三支萨克布（左边、响），第二合唱是四种竖笛 + 便携管风琴（右边、轻），
//   一句由第一合唱奏、第二合唱在对面轻轻地回声，再交替、最后两边合起来终止（加布里埃利的“轻与响”）；簧管风琴在中间铺和弦；
// - 弗罗托拉（frottola）：街头与宫廷的分节歌——高音竖笛唱旋律（同音反复、附点），中音竖笛三度跟着，鲁特琴分解和弦，维奥尔琴走低音，意大利铃鼓打拍子；
// - 尾声：变格终止（C → G，“阿门”终止）。和声是文艺复兴的三和弦（根音位置为主），四个声部逐个写出（不靠伴奏型）。旋律原创。
import type { TrackDef } from "../score";

/** 八小节的一个声部（每小节一格），keep 给出时只奏这几小节、其余是整小节的休止（分开的合唱：两边轮流）。 */
function bars(cells: readonly string[], keep?: readonly number[]): string {
  return cells.map((c, i) => (!keep || keep.includes(i) ? c : "z8")).join(" | ");
}

// 叠句（A）：坎佐纳的主题配成四个声部
const A_S = ["G4 G2 G2", "c4 e2 c2", "d4 B2 G2", "A2 B2 c2 A2", "B4 d2 B2", "c2 B2 A2 G2", "^F2 G2 A4", "G8"];
const A_A = ["D4 D2 D2", "E4 G2 E2", "D4 D2 D2", "^F4 E2 D2", "D4 G2 D2", "E2 D2 C2 E2", "D4 D4", "D8"];
// 次中音避开与低音、高音的平行八度与五度（第 3 小节第三拍走 D、第 4 小节末拍走升 F、第 6 小节末拍回 C；审查后改，旋律与和声不变）
const A_T = ["B,4 B,2 B,2", "C4 C2 G,2", "B,4 D2 B,2", "A,4 A,2 ^F,2", "B,4 B,2 G,2", "C4 G,2 C2", "A,4 ^F,2 A,2", "B,8"];
const A_B = ["G,4 G,2 G,2", "E,4 C,4", "B,,4 G,,4", "D,4 D,2 D,2", "G,4 G,,4", "E,4 C,4", "D,4 D,,4", "G,,8"];

// 分开的合唱（B）：第一合唱奏第 1–2、5–6 小节，第二合唱在第 3–4 小节回声，第 7–8 小节两边一起终止
const B_S = ["e3 d c2 e2", "d4 B4", "e3 d c2 e2", "d4 B4", "f3 e d2 c2", "e4 c4", "c4 A2 ^F2", "G8"];
// 中音与次中音避开平行（第 2、4 小节次中音走 G — D，不跟高音一起从 E 落到 D；第 6 小节中音后半落到 E、次中音走 E — G，进第 7 小节时不随低音整体下行）
const B_A = ["c3 B A2 c2", "B4 G4", "c3 B A2 c2", "B4 G4", "c3 c A2 A2", "G4 E4", "E4 ^F2 D2", "D8"];
const B_T = ["G,4 E,4", "G,4 D4", "G,4 E,4", "G,4 D4", "A,4 F,4", "E,4 G,4", "A,4 A,4", "B,8"];
const B_B = ["C,4 C,2 C,2", "G,,4 G,,4", "C,4 C,2 C,2", "G,,4 G,,4", "F,,4 F,,2 F,,2", "C,4 C,4", "A,,4 D,4", "G,,8"];
const CHOIR1 = [0, 1, 4, 5, 6, 7];
const CHOIR2 = [2, 3, 6, 7];

export const PORT_ITALY: TrackDef = {
  id: "port_italy",
  title: { zh: "商馆与凉廊", en: "Fondaco and Loggia" },
  qpm: 108,
  meter: [4, 4],
  key: "G mixolydian",
  voices: {
    // 第一合唱（左）：短号与三支萨克布
    cornett: { inst: "cornett", gain: 0.56, pan: -0.22, reverb: 0.36 },
    sba: { inst: "sackbut", gain: 0.3, pan: -0.34, reverb: 0.36 },
    sbt: { inst: "sackbut", gain: 0.32, pan: -0.12, reverb: 0.36 },
    sbb: { inst: "sackbut", gain: 0.38, pan: -0.26, reverb: 0.34 },
    // 第二合唱（右）：四种竖笛与便携管风琴
    recs: { inst: "rec_soprano", gain: 0.34, pan: 0.24, reverb: 0.34 },
    reca: { inst: "rec_alto", gain: 0.29, pan: 0.34, reverb: 0.34 },
    rect: { inst: "rec_tenor", gain: 0.29, pan: 0.14, reverb: 0.34 },
    recb: { inst: "rec_bass", gain: 0.32, pan: 0.3, reverb: 0.32 },
    organ: { inst: "organetto", gain: 0.24, pan: 0.2, reverb: 0.34 },
    // 中间：簧管风琴的和弦（数字低音的前身）
    regal: { inst: "regal", gain: 0.2, pan: 0, reverb: 0.32, pattern: { kind: "pad", low: 50, high: 67, size: 3 } },
    // 弗罗托拉：鲁特琴的分解和弦、维奥尔琴的低音
    liuto: { inst: "liuto", gain: 0.36, pan: 0.28, reverb: 0.26, pattern: { kind: "arp", low: 43, steps: "1 5 8 5 10 5 8 5", ring: 2 } },
    gamba: { inst: "gamba", gain: 0.4, pan: 0.2, reverb: 0.26, pattern: { kind: "arp", low: 43, steps: "1 . . . 5, . . ." } },
    tamb: {
      inst: "perc",
      gain: 0.4,
      pan: -0.3,
      reverb: 0.24,
      pattern: {
        a: { kind: "drum", steps: "T.s.t.s.", hits: { T: ["tamburello", 0.5], t: ["tamburello", 0.32], s: ["tamburello_shake", 0.28] } },
        b: { kind: "drum", steps: "T...t.s.", hits: { T: ["tamburello", 0.46], t: ["tamburello", 0.3], s: ["tamburello_shake", 0.26] } },
      },
    },
    nakers: {
      inst: "perc",
      gain: 0.3,
      pan: -0.1,
      reverb: 0.28,
      pattern: {
        a: { kind: "drum", steps: "L...h.h.", hits: { L: ["naker_lo", 0.5], h: ["naker_hi", 0.34] } },
        e: { kind: "drum", steps: "L...L...L.......", hits: { L: ["naker_lo", 0.55] } },
      },
    },
    // 衬底（合成）：很轻的弦乐长音与拨奏低音
    pad: { inst: "strings", gain: 0.12, pan: 0.18, reverb: 0.4, pattern: { kind: "pad", low: 55, high: 70, size: 3 } },
    pz: { inst: "pizz", gain: 0.18, pan: 0.06, reverb: 0.15, pattern: { kind: "arp", low: 31, steps: "1 . . . 5, . . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "G | C | G | C",
      // 坎佐纳的开头：短号独自，两小节后低音萨克布在两个八度之下模仿
      lines: { s: "G4 G2 G2 | c4 e2 c2 | d4 B2 G2 | A2 B2 c2 A2", b: "z8 | z8 | G,,4 G,,2 G,,2 | C,4 E,2 C,2" },
    },
    A: {
      bars: 8,
      chords: "G | C | G | D | G | C | D | G",
      lines: { s: bars(A_S), a: bars(A_A), t: bars(A_T), b: bars(A_B) },
    },
    B: {
      bars: 8,
      chords: "C | G | C | G | F | C | Am*4 D*4 | G",
      lines: {
        s1: bars(B_S, CHOIR1),
        a1: bars(B_A, CHOIR1),
        t1: bars(B_T, CHOIR1),
        b1: bars(B_B, CHOIR1),
        s2: bars(B_S, CHOIR2),
        a2: bars(B_A, CHOIR2),
        t2: bars(B_T, CHOIR2),
        b2: bars(B_B, CHOIR2),
      },
    },
    C: {
      bars: 8,
      chords: "G | C | D | G | Em | C | D | G",
      lines: {
        fmel: "B3 B B2 d2 | c3 c c2 e2 | d2 B2 A2 ^F2 | G4 z2 D2 | E3 ^F G2 B2 | c2 B2 A2 G2 | A2 B2 c2 A2 | G6 z2",
        falto: "G3 G G2 B2 | A3 A A2 c2 | B2 G2 ^F2 D2 | D4 z2 B,2 | B,3 D E2 G2 | A2 G2 E2 E2 | ^F2 G2 A2 ^F2 | D6 z2",
      },
    },
    coda: {
      bars: 2,
      chords: "C | G",
      lines: { es: "c4 c4 | B8", ea: "G4 G4 | G8", et: "E4 E4 | D8", eb: "C,4 C,4 | G,,8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "s:cornett b:sbb", dyn: 0.64 },
      { s: "A", play: "s:cornett a:sba t:sbt b:sbb nakers.a regal pz", dyn: 0.68 },
      { s: "B", play: "s1:cornett a1:sba t1:sbt b1:sbb s2:recs+12 a2:reca+12 t2:rect+12 b2:recb+12 s2:organ regal pad", dyn: 0.7 },
      { s: "C", play: "fmel:recs+12 falto:reca+12 liuto gamba tamb.a pz", dyn: 0.66 },
      { s: "A", play: "s:cornett a:sba t:sbt b:sbb s:recs+12 a:reca+12 s:organ regal nakers.a tamb.b pad pz", dyn: 0.74, rit: 0.96 },
      { s: "coda", play: "es:cornett ea:sba et:sbt eb:sbb es:recs+12 es:organ regal nakers.e pad", dyn: 0.72, rit: 0.84 },
    ],
    [
      { s: "A", play: "s:recs+12 a:reca+12 t:rect+12 b:recb+12 s:organ regal pad", dyn: 0.64 },
      { s: "C", play: "fmel:cornett falto:reca+12 liuto gamba tamb.a pz", dyn: 0.68 },
      { s: "B", play: "s1:cornett a1:sba t1:sbt b1:sbb s2:recs+12 a2:reca+12 t2:rect+12 b2:recb+12 s2:organ regal pad", dyn: 0.7, rit: 0.96 },
      { s: "coda", play: "es:cornett ea:sba et:sbt eb:sbb es:organ regal nakers.e pad", dyn: 0.7, rit: 0.84 },
    ],
  ],
  rest: [10, 18],
  level: 1.02,
};
