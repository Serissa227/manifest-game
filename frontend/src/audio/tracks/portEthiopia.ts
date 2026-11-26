// 《盐砖与乳香》：埃塞俄比亚的港口（马萨瓦：高原上的盐砖、乳香、咖啡与象牙从这里下海，教堂的钟声与阿兹马里的歌声）。
// 地方特色第二阶段·非洲：埃塞俄比亚的乐器领奏（复古合成版的衬底用合成的大提琴组与持续音）。旋律原创。
// E 上的两种“格涅特”（qenet，五声的调式），6/8 拍（每分钟 132 个四分音符），凯贝罗鼓与拍手打“奇克奇卡”（chik-chika）的长短律动：
// 两种色彩分开：贝格纳琴（只伴祈祷与冥想的歌）与采纳齐尔叉铃（教会的叉铃）是“殿里”的声音，只在引子与尾声——远处的教堂；
// A、B、C 段是阿兹马里（游吟歌手）的世俗音乐：克拉尔琴、马森果、瓦辛特笛、凯贝罗鼓与拍手，不夹宗教乐器。
// - 引子：贝格纳琴在低处慢慢地拨（皮片的嗡声留着），采纳齐尔叉铃“沙啦”地摇，山上牧人的瓦辛特笛从下面滑上来吹一句；
// - A：安奇霍耶（E F A 降B 升C——小二度、增四度与增二度，一听就是高原的颜色），克拉尔琴领奏，第二把克拉尔琴转着固定的音型，
//   再一遍马森果（单弦提琴）用同一条旋律拉出“异音”（拉长、滑上去、揉开）；
// - B：换到提兹塔（小调的一种：E 升F G B C，“提兹塔”是怀念的意思），瓦辛特笛唱，领奏的克拉尔琴退到低音区拨低音、第二把转固定音型；
//   第二遍马森果唱（加上轻轻的拍手）；
// - C：一领众和——马森果在高处“喊”两小节，克拉尔琴与拍手应两小节；
// - A″：克拉尔琴、马森果、瓦辛特笛一起，鼓加花；尾声克拉尔琴落下来、贝格纳琴的最低音收住。
// 和声：不写西洋的三和弦。安奇霍耶里没有纯五度（主音上方是降 B），所以 A、C 段的衬底只有 E 的八度；提兹塔里才有 E–B 的空五度。
import type { TrackDef } from "../score";

/** 一小节的格子重复 n 遍（小节线分开）。 */
const rep = (bar: string, n: number) => Array.from({ length: n }, () => bar).join(" | ");

/** 第二把克拉尔琴的固定音型（两小节一圈）：安奇霍耶与提兹塔各一种。 */
const OST_A = rep("E, A, _B, E _B, A, | E, A, ^C E ^C A,", 4);
const OST_B = rep("E, B, E G E B, | E, B, ^F G ^F B,", 4);

export const PORT_ETHIOPIA: TrackDef = {
  id: "port_ethiopia",
  title: { zh: "盐砖与乳香", en: "Salt Bars and Frankincense" },
  qpm: 132,
  meter: [6, 8],
  key: "E phrygian",
  voices: {
    krar: { inst: "krar", gain: 0.55, pan: -0.12, reverb: 0.24 },
    krar2: { inst: "krar", gain: 0.28, pan: -0.34, reverb: 0.22 },
    masenqo: { inst: "masenqo", gain: 0.5, pan: 0.16, reverb: 0.3 },
    washint: { inst: "washint", gain: 0.48, pan: 0.26, reverb: 0.38 },
    begena: { inst: "begena", gain: 0.55, pan: -0.04, reverb: 0.4 },
    kebero: {
      inst: "perc",
      gain: 0.3,
      pan: 0.06,
      reverb: 0.24,
      pattern: {
        a: { kind: "drum", steps: "D.tD.t", hits: { D: ["kebero_dum", 0.8], t: ["kebero_ta", 0.55] } },
        b: { kind: "drum", steps: "D.....D..t..", hits: { D: ["kebero_dum", 0.7], t: ["kebero_ta", 0.45] } },
        c: { kind: "drum", steps: "D.tDstD.tDtt", hits: { D: ["kebero_dum", 0.85], t: ["kebero_ta", 0.6], s: ["kebero_slap", 0.6] } },
        intro: { kind: "drum", steps: "..................D.tDtt", hits: { D: ["kebero_dum", 0.75], t: ["kebero_ta", 0.5] } },
        coda: { kind: "drum", steps: "D.tD..D.....", hits: { D: ["kebero_dum", 0.9], t: ["kebero_ta", 0.6] } },
      },
    },
    clap: {
      inst: "perc",
      gain: 0.22,
      pan: -0.22,
      reverb: 0.22,
      pattern: {
        a: { kind: "drum", steps: "C.cC.c", hits: { C: ["chebchebba", 0.6], c: ["chebchebba_soft", 0.4] } },
        b: { kind: "drum", steps: "..c..c", hits: { c: ["chebchebba_soft", 0.45] } },
      },
    },
    tsen: {
      inst: "perc",
      gain: 0.2,
      pan: 0.34,
      reverb: 0.36,
      pattern: {
        intro: { kind: "drum", steps: "T.....s.....T.....s.T.s.", hits: { T: ["tsenatsil", 0.6], s: ["tsenatsil_soft", 0.45] } },
        coda: { kind: "drum", steps: "T...........", hits: { T: ["tsenatsil", 0.6] } },
      },
    },
    // 衬底（合成）：大提琴组拉主音的长音，持续音在 A、C 段只有 E 的八度、B 段加上 B
    low: { inst: "celli", gain: 0.2, pan: 0.12, reverb: 0.26 },
    pad: {
      inst: "drone",
      gain: 0.16,
      pan: -0.18,
      reverb: 0.42,
      pattern: { a: { kind: "drone", notes: [40, 52] }, b: { kind: "drone", notes: [40, 47, 52] } },
    },
  },
  sections: {
    intro: {
      bars: 4,
      lines: {
        beg: "E,,3 z3 | A,,3 _B,,3 | A,,3 F,,3 | E,,6",
        call: "z6 | !bend!^c3 e2 ^c | !vib!_B3 A3 | F3 !fall!E3",
        root: rep("E,,6", 4),
      },
    },
    A: {
      bars: 8,
      lines: {
        mel: "e2 ^c _B2 A | _B ^c _B A2 F | A2 F E2 F | !vib!A3 z2 F | A2 _B ^c2 e | f2 e ^c2 _B | A _B A F2 E | !fall!E3 z3",
        // 马森果的异音：同一条旋律拉长、滑上去、揉开
        het: "!bend!e3 ^c _B A | !vib!_B3 A2 F | A3 E2 F | !vib!A6 | !bend!A2 _B !bend!^c2 e | !vib!f3 ^c2 _B | A2 F F2 E | !fall!E6",
        ost: OST_A,
        root: rep("E,,6", 8),
      },
    },
    B: {
      bars: 8,
      chords: rep("E5", 8),
      lines: {
        bmel: "B3 c2 B | !vib!G6 | ^F2 G B2 c | !bend!B6 | e3 c2 B | G2 ^F E2 ^F | G3 ^F2 E | !fall!E6",
        // 低音：领奏的克拉尔琴在低音区拨（演奏时移高八度，到 E3 一带）
        blow: "E,,3 B,,3 | E,,6 | ^F,,3 B,,3 | E,,6 | G,,3 B,,3 | G,,3 ^F,,3 | E,,3 B,,3 | E,,6",
        bost: OST_B,
        root: rep("E,,6", 8),
      },
    },
    C: {
      bars: 8,
      lines: {
        // 一领：马森果在高处“喊”
        call: "!bend!a3 f2 e | !vib!f6 | z6 | z6 | !bend!a3 _b2 a | !fall!f6 | z6 | z6",
        // 众和：克拉尔琴与拍手
        resp: "z6 | z6 | e2 ^c _B2 A | A6 | z6 | z6 | f2 e ^c2 _B | A3 E3",
        ost: OST_A,
        root: rep("E,,6", 8),
      },
    },
    coda: {
      bars: 2,
      lines: {
        end: "e2 ^c _B A F | E3 z3",
        beg: "z6 | E,,6",
        root: rep("E,,6", 2),
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "beg:begena call:washint tsen.intro kebero.intro root:low pad.a", dyn: 0.6, to: 0.66 },
      { s: "A", play: "mel:krar ost:krar2 kebero.a clap.a root:low pad.a", dyn: 0.66 },
      { s: "A", play: "mel:krar het:masenqo ost:krar2 kebero.a clap.a root:low pad.a", dyn: 0.7 },
      { s: "B", play: "bmel:washint blow:krar+12 bost:krar2 kebero.b root:low pad.b", dyn: 0.62 },
      { s: "C", play: "call:masenqo resp:krar ost:krar2 kebero.a clap.a root:low pad.a", dyn: 0.7 },
      { s: "B", play: "bmel:masenqo blow:krar+12 bost:krar2 kebero.b clap.b root:low pad.b", dyn: 0.66 },
      { s: "A", play: "mel:krar het:masenqo mel:washint ost:krar2 kebero.c clap.a root:low pad.a", dyn: 0.74 },
      { s: "coda", play: "end:krar beg:begena kebero.coda tsen.coda root:low", dyn: 0.72, rit: 0.88 },
    ],
    [
      { s: "A", play: "mel:krar ost:krar2 kebero.a clap.a root:low pad.a", dyn: 0.64 },
      { s: "B", play: "bmel:washint blow:krar+12 bost:krar2 kebero.b root:low pad.b", dyn: 0.62 },
      { s: "C", play: "call:masenqo resp:krar ost:krar2 kebero.a clap.a root:low pad.a", dyn: 0.68 },
      { s: "A", play: "mel:krar het:masenqo ost:krar2 kebero.c clap.a root:low pad.a", dyn: 0.72 },
      { s: "coda", play: "end:krar beg:begena kebero.coda tsen.coda root:low", dyn: 0.7, rit: 0.88 },
    ],
  ],
  rest: [10, 18],
  level: 1.15,
};
