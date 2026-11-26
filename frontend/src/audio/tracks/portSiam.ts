// 《湄南河的水市》：暹罗的港口（阿瑜陀耶城外的湄南河、船上的水市、寺院的金顶）。地方特色第二阶段：暹罗的 piphat 乐队领奏。
// 律：暹罗的七平均律（一个八度七个等分，每级约 171 音分）按四分之一音近似——G A 半降B D 半降E 的五声（_/B、_/E 是中立的三度与六度，
// 既不是大调也不是小调，一听就知道是暹罗）；B 段换一组五声（C 代替半降B，暹罗音乐的“换调”thang 只动一个音）。
// 织体是“异音”：同一条骨干（luk tok，每拍一个音）——孔旺艾大围锣奏骨干本身（句尾隔八度一起敲），拉那·艾高音木琴两个八度把它绕成一串八分音符，
// 拉那·通低音木琴切分着逗，皮奈双簧管拉长了唱；钦（碗钹）开的“钦”落在弱拍、合的“恰”落在强拍（一句的最后一拍最重），塔蓬鼓奏两小节一圈的鼓型。
// 曲式按暹罗的“三层速度”（thao）：
// - 引子：皮奈一句（sam chan 的疏的钦），高音木琴跑上去；
// - A：中速（song chan），木琴、围锣、低音木琴，第二遍皮奈加入；
// - B：mahori（丝竹）的一段：克卢伊竖笛与索乌椰壳胡琴，换到 C 的五声，高音木琴只奏一个八度、轻轻地绕，钦回到慢的一层；
// - C：快板（chan diao）：骨干每两拍取一个音、缩成一半，钦每拍一下，木琴十六分音符，越奏越快，大桶鼓“咚”地跟上；
// - 尾声（luk mot）：全体齐奏一句，钦—恰，大桶鼓收。
// 没有西洋的和弦：只有很轻的 G–D 空五度持续音托底。
import type { TrackDef } from "../score";
import { contract, gongCircle, paraphrase, syncopate } from "./mainland";
import type { Ladder } from "./weave";

/** G 组的五声（七平均律近似），从低到高。 */
const SIAM_G: Ladder = { notes: ["D", "_/E", "G", "A", "_/B", "d", "_/e", "g", "a", "_/b", "d'"] };
/** C 组的五声（B 段：C 代替半降B）。 */
const SIAM_C: Ladder = { notes: ["C", "D", "_/E", "G", "A", "c", "d", "_/e", "g", "a"] };

/** A 段的骨干：八小节，每小节最后一拍是落点（d、G、半降B、D、d、d、A、G）。 */
const CORE_A = ["d", "_/e", "d", "_/B", "A", "_/B", "A", "G", "_/E", "G", "A", "_/B", "A", "G", "_/E", "D", "G", "A", "_/B", "d", "_/e", "g", "_/e", "d", "_/B", "d", "_/B", "A", "G", "_/E", "A", "G"];
/** B 段的骨干（C 组），落在 D 上，回到 A 段。 */
const CORE_B = ["G", "A", "c", "d", "_/e", "d", "c", "A", "G", "A", "G", "_/E", "D", "_/E", "G", "A", "c", "d", "_/e", "g", "_/e", "d", "c", "A", "G", "_/E", "D", "_/E", "C", "D", "_/E", "D"];
/** C 段（快板）：A 段的骨干每两拍取一个音（句尾的音都在），四小节。 */
const CORE_C = contract(CORE_A);

export const PORT_SIAM: TrackDef = {
  id: "port_siam",
  title: { zh: "湄南河的水市", en: "Water Market on the Chao Phraya" },
  qpm: 96,
  meter: [4, 4],
  key: "G mixolydian",
  voices: {
    khong: { inst: "khong_wong", gain: 0.34, pan: -0.12, reverb: 0.34 },
    ranat: { inst: "ranat_ek", gain: 0.24, pan: 0.22, reverb: 0.28 },
    thum: { inst: "ranat_thum", gain: 0.34, pan: -0.28, reverb: 0.28 },
    pi: { inst: "pi_nai", gain: 0.44, pan: 0.06, reverb: 0.34 },
    khlui: { inst: "khlui", gain: 0.44, pan: 0.16, reverb: 0.38 },
    sawu: { inst: "saw_u", gain: 0.42, pan: -0.16, reverb: 0.34 },
    ching: {
      inst: "perc",
      gain: 0.26,
      pan: 0.3,
      reverb: 0.3,
      pattern: {
        // song chan：钦在第二拍、恰在第四拍
        a: { kind: "drum", steps: "..o...c.", hits: { o: ["ching", 0.75], c: ["chap", 0.8] } },
        // sam chan：一小节一下，钦、恰轮流
        sam: { kind: "drum", steps: "......o.......c.", hits: { o: ["ching", 0.7], c: ["chap", 0.75] } },
        // chan diao：每拍一下
        diao: { kind: "drum", steps: "o.c.o.c.", hits: { o: ["ching", 0.75], c: ["chap", 0.85] } },
        intro: { kind: "drum", steps: "......o.......c.......o.......c.", hits: { o: ["ching", 0.7], c: ["chap", 0.75] } },
        coda: { kind: "drum", steps: "o.c.o.c.c.......", hits: { o: ["ching", 0.8], c: ["chap", 0.9] } },
      },
    },
    taphon: {
      inst: "perc",
      gain: 0.3,
      pan: -0.04,
      reverb: 0.26,
      pattern: {
        // 两小节一圈的鼓型，“通”落在每小节的第四拍（恰），一圈的最后一下最重
        a: { kind: "drum", steps: "p.t.p.T.t.p.ptT.", hits: { T: ["taphon_tup", 0.85], p: ["taphon_pa", 0.6], t: ["taphon_ting", 0.65] } },
        b: { kind: "drum", steps: "....t.......t.T.", hits: { T: ["taphon_tup", 0.55], t: ["taphon_ting", 0.5] } },
        c: { kind: "drum", steps: "p.tTp.tT", hits: { T: ["taphon_tup", 0.85], p: ["taphon_pa", 0.6], t: ["taphon_ting", 0.65] } },
        coda: { kind: "drum", steps: "ptpTptpTT.......", hits: { T: ["taphon_tup", 0.9], p: ["taphon_pa", 0.65], t: ["taphon_ting", 0.7] } },
      },
    },
    klong: {
      inst: "perc",
      gain: 0.28,
      pan: 0,
      reverb: 0.4,
      pattern: {
        a: { kind: "drum", steps: "..............L.", hits: { L: ["klong_that", 0.7] } },
        intro: { kind: "drum", steps: "........................L.....L.", hits: { L: ["klong_that", 0.75] } },
        c: { kind: "drum", steps: "......H.......L.", hits: { L: ["klong_that", 0.8], H: ["klong_that_hi", 0.7] } },
        coda: { kind: "drum", steps: "L.L.L.H.L.......", hits: { L: ["klong_that", 0.9], H: ["klong_that_hi", 0.8] } },
      },
    },
    // 衬底（合成）：很轻的 G–D 空五度，低音拨奏在两小节一圈的落点上点一下
    pad: { inst: "drone", gain: 0.1, pan: -0.16, reverb: 0.46, pattern: { kind: "drone", notes: [43, 50] } },
    bass: { inst: "pizz", gain: 0.22, pan: 0.08, reverb: 0.2 },
  },
  sections: {
    intro: {
      bars: 4,
      lines: {
        pi: "!bend!d6 _/e d | !vib!_/B4 A G _/E D | G2 A _/B !bend!d4 | z8",
        rek: "z8 | z8 | z8 | d _/e g _/e d _/B A _/B",
      },
    },
    A: {
      bars: 8,
      lines: {
        core: gongCircle(CORE_A),
        rek: paraphrase(CORE_A, SIAM_G),
        thum: syncopate(CORE_A),
        pi: "!bend!d4 _/e d _/B2 | (A2 _/B) A !vib!G4 | _/E2 G A !bend!_/B4 | A G _/E G !fall!D4 | G2 A _/B !bend!d4 | _/e2 g2 !vib!_/e2 d2 | !bend!_/B4 d _/B A2 | G2 _/E2 A2 !vib!G2",
        low: "z8 | z6 G,,2 | z8 | z6 D,2 | z8 | z6 D,2 | z8 | z6 G,,2",
      },
    },
    B: {
      bars: 8,
      lines: {
        core: gongCircle(CORE_B),
        thum: syncopate(CORE_B),
        rekb: paraphrase(CORE_B, SIAM_C, false, "d"),
        khlui: "G2 A c !bend!d4 | _/e d c d !vib!A4 | G4 A G _/E2 | D _/E G2 !bend!A4 | c2 d _/e !bend!g4 | (_/e d) (c d) !vib!A4 | G2 _/E D !vib!_/E4 | C D _/E2 D4",
        sawu: "G,2 A, C !vib!D4 | _/E2 D C A,4 | G,6 _/E,2 | D,2 _/E, G, !bend!A,4 | C2 D _/E !vib!G4 | _/E2 D2 C2 A,2 | G,4 D,2 _/E,2 | C,2 D,2 !vib!D,4",
        low: "z8 | z6 D,2 | z8 | z6 A,,2 | z8 | z6 A,,2 | z8 | z6 D,2",
      },
    },
    C: {
      bars: 4,
      lines: {
        core: gongCircle(CORE_C),
        rekd: paraphrase(CORE_C, SIAM_G, true),
        thum: syncopate(CORE_C),
        pic: "_/e d _/B A _/B2 G2 | G A _/B A !bend!G2 D2 | A2 d2 !bend!g2 d2 | d _/B A2 _/E2 G2",
        low: "z6 G,,2 | z6 D,2 | z6 D,2 | z6 G,,2",
      },
    },
    coda: {
      bars: 2,
      lines: {
        end: "g _/e d _/B A _/B A G | [G,G]2 z6",
        low: "z8 | G,,2 z6",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "pi:pi rek:ranat rek:ranat+12 ching.intro klong.intro pad", dyn: 0.62 },
      { s: "A", play: "core:khong rek:ranat rek:ranat+12 thum:thum ching taphon klong pad low:bass", dyn: 0.66 },
      { s: "A", play: "core:khong rek:ranat rek:ranat+12 thum:thum pi:pi ching taphon klong pad low:bass", dyn: 0.7 },
      { s: "B", play: "core:khong rekb:ranat khlui:khlui sawu:sawu thum:thum ching.sam taphon.b pad low:bass", dyn: 0.58 },
      { s: "C", play: "core:khong rekd:ranat rekd:ranat+12 thum:thum pic:pi ching.diao taphon.c klong.c pad low:bass", dyn: 0.72, tempo: 1.04, rit: 1.12 },
      { s: "C", play: "core:khong rekd:ranat rekd:ranat+12 thum:thum pic:pi ching.diao taphon.c klong.c pad low:bass", dyn: 0.76, tempo: 1.12, rit: 1.2 },
      { s: "coda", play: "end:ranat end:ranat+12 end:khong end:thum-12 ching.coda taphon.coda klong.coda low:bass", dyn: 0.78, tempo: 1.2, rit: 1.05 },
    ],
    [
      { s: "A", play: "core:khong rek:ranat rek:ranat+12 thum:thum pi:pi ching taphon klong pad low:bass", dyn: 0.68 },
      { s: "B", play: "core:khong rekb:ranat khlui:khlui sawu:sawu thum:thum ching.sam taphon.b pad low:bass", dyn: 0.58 },
      { s: "C", play: "core:khong rekd:ranat rekd:ranat+12 thum:thum pic:pi ching.diao taphon.c klong.c pad low:bass", dyn: 0.72, tempo: 1.04, rit: 1.12 },
      { s: "C", play: "core:khong rekd:ranat rekd:ranat+12 thum:thum pic:pi ching.diao taphon.c klong.c pad low:bass", dyn: 0.76, tempo: 1.12, rit: 1.2 },
      { s: "coda", play: "end:ranat end:ranat+12 end:khong end:thum-12 ching.coda taphon.coda klong.coda low:bass", dyn: 0.78, tempo: 1.2, rit: 1.05 },
    ],
  ],
  rest: [10, 18],
  level: 1.2,
};
