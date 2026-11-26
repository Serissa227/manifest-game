// 《浦口的长鼓》：朝鲜的港口（釜山浦、济物浦、盐浦……倭馆与市集，人参、木棉、腌鱼与铜的码头）。
// 地方特色第二阶段：地方乐器领奏（复古合成版的衬底用合成的持续音与大提琴组）。
// A 上的南道界面调（계면조：la = A 平着唱，mi = E 揉得又深又宽，do → si 往下“折”，偶尔经过 re 与 sol），12/8 拍（每分钟 96 个四分音符：附点四分音符一拍约 64），
// 句尾多是从平着的 la 落到深揉的 mi（라 → 미）；揉弦（!vib!）只给 mi 的长音，la 一律不揉——“mi 深揉、la 平”是界面调一听就认得出的地方。
// 长短（장단）由慢到快，像散调一样一路催紧：
// - 引子：钲“嗡——”一声，大笒慢慢吹出一句（深揉的 mi、折下来的 do → si、平着的 la，再落到深揉的低 mi），伽倻琴零零星星地应，杖鼓最后“덩 · 쿵 · 더러”引进来；
// - A（굿거리 长短：덩 · 기덕 | 쿵 더러러러 | 쿵 · 기덕 | 쿵 더러러러）：伽倻琴领奏，每个 mi 的长音都弄弦，鼓（북）落拍，钲每四个长短敲一下；
//   第二遍奚琴跟着同一条旋律拉长、滑着走（异音齐奏），玄琴在低音区“砸”根音；
// - B（중모리：十二个单拍、每拍一个四分音符，一个长短占两小节，约 8.5 秒一轮——比 A 的굿거리一轮长一倍多；旋律六拍一句，第九拍落定、长音拖到第十二拍）：
//   转到 G 上的平调（sol la do re mi，明亮、稳；揉 re 与 sol，不揉 mi），奚琴唱、大笒在长音的空处应（第二遍两件对调），玄琴在第一、五、九拍托底；
// - A′（자진모리：同一条旋律快一倍半）：太平箫领、觱篥异音，小金“갱 갠지”、钲每个长短一下、鼓与杖鼓全上——农乐（풍물）的热闹；
// - 尾声：伽倻琴一扫、钲收。
// 不写西洋的三和弦：衬底只有空五度的持续音（A–E、D–A、E–B、G–D、C–G）。
import type { TrackDef } from "../score";

/** 一小节重复 n 次（| 隔开）。 */
const rep = (bar: string, n: number) => Array.from({ length: n }, () => bar).join(" | ");

export const PORT_KOREA: TrackDef = {
  id: "port_korea",
  title: { zh: "浦口的长鼓", en: "Janggu by the Harbour" },
  qpm: 96,
  meter: [12, 8],
  key: "A minor",
  voices: {
    gayageum: { inst: "gayageum", gain: 0.6, pan: -0.14, reverb: 0.3 },
    geomungo: { inst: "geomungo", gain: 0.4, pan: 0.24, reverb: 0.28 },
    haegeum: { inst: "haegeum", gain: 0.5, pan: 0.16, reverb: 0.3 },
    daegeum: { inst: "daegeum", gain: 0.54, pan: -0.22, reverb: 0.42 },
    piri: { inst: "piri", gain: 0.4, pan: 0.1, reverb: 0.3 },
    taep: { inst: "taepyeongso", gain: 0.38, pan: -0.06, reverb: 0.3 },
    jing: { inst: "jing", gain: 0.34, pan: 0.02, reverb: 0.46 },
    janggu: {
      inst: "perc",
      gain: 0.3,
      pan: 0.04,
      reverb: 0.26,
      pattern: {
        // 굿거리（每格十六分音符）：덩 · 기덕 | 쿵 더러러러 | 쿵 · 기덕 | 쿵 더러러러
        gut: {
          kind: "drum",
          grid: 0.5,
          steps: "D...gkK.drrrK...gkK.drrr",
          hits: { D: ["janggu_deong", 0.85], g: ["janggu_gi", 0.4], k: ["janggu_deok", 0.65], K: ["janggu_kung", 0.7], d: ["janggu_deok", 0.5], r: ["janggu_gi", 0.35] },
        },
        // 중모리（每格一个四分音符的单拍，十二拍占两小节）：덩 · 덕 쿵 덕 · | 쿵 · 덩 덕 쿵 ·（第一拍与第九拍是“덩”）
        jung: { kind: "drum", grid: 2, steps: "D.kKk.K.DkK.", hits: { D: ["janggu_deong", 0.8], k: ["janggu_deok", 0.55], K: ["janggu_kung", 0.65] } },
        // 자진모리：덩 · 덕 쿵 · 덕 | 쿵 · 덕 쿵 · 덕
        jajin: { kind: "drum", steps: "D.kK.kK.kK.k", hits: { D: ["janggu_deong", 0.9], k: ["janggu_deok", 0.65], K: ["janggu_kung", 0.75] } },
        intro: { kind: "drum", steps: "........................D.....K...rr", hits: { D: ["janggu_deong", 0.75], K: ["janggu_kung", 0.6], r: ["janggu_gi", 0.4] } },
        coda: { kind: "drum", steps: "D..D..D.................", hits: { D: ["janggu_deong", 0.9] } },
      },
    },
    buk: {
      inst: "perc",
      gain: 0.27,
      pan: 0.14,
      reverb: 0.26,
      pattern: {
        gut: { kind: "drum", steps: "B..r..b..r..", hits: { B: ["buk", 0.8], b: ["buk", 0.5], r: ["buk_rim", 0.5] } },
        jung: { kind: "drum", grid: 2, steps: "B..r..b.Br..", hits: { B: ["buk", 0.75], b: ["buk", 0.45], r: ["buk_rim", 0.45] } },
        jajin: { kind: "drum", steps: "B.rB.rB.rBrr", hits: { B: ["buk", 0.85], r: ["buk_rim", 0.5] } },
        coda: { kind: "drum", steps: "B..B..B.................", hits: { B: ["buk", 0.9] } },
      },
    },
    kkwaeng: {
      inst: "perc",
      gain: 0.16,
      pan: -0.26,
      reverb: 0.3,
      // 갱 · 갠 갱 · 갠 | 갱 · 갠 갱 갠 갠
      pattern: { kind: "drum", steps: "X.xX.xX.xXxx", hits: { X: ["kkwaeng", 0.75], x: ["kkwaeng_mute", 0.5] } },
    },
    // 衬底（合成）：空五度的持续音、大提琴组的长音
    pad: { inst: "drone", gain: 0.18, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 52, high: 71, size: 2 } },
    low: { inst: "celli", gain: 0.18, pan: 0.12, reverb: 0.26, pattern: { kind: "arp", low: 40, steps: "1 . . . . . . . . . . .", ring: 12 } },
  },
  sections: {
    intro: {
      bars: 3,
      chords: "A5 | A5 | A5",
      lines: {
        // 大笒：深揉的 mi、折下来的 do → si、平着的 la，再落到深揉的低 mi（伽倻琴在底下平着弹 la）
        call: "!vib!e9 d2 c | (c B5) A6 | !vib!E9 z3",
        gl: "z6 A,3 !vib!E3 | z6 {G}!vib!E3 A3 | c3 {c}B3 A6",
        jg: "A,,12 | z12 | A,,12",
      },
    },
    A: {
      bars: 8,
      chords: "A5 | D5 | A5 | E5 | A5 | D5 | A5 | A5",
      lines: {
        // 伽倻琴：mi 的长音弄弦，la 平着弹，句尾 la → 深揉的 mi
        mel: "A2 c d2 e !vib!e6 | d2 c {c}B2 A7 | c2 d e2 g a3 g2 e | d2 e {e}d2 c {c}B3 A3 | e2 g a3 g2 e !vib!e3 | d2 e d2 c {c}B3 A3 | E2 A c2 d e2 d c2 B | A3 !vib!E6 z3",
        // 奚琴 / 觱篥的异音：同一条旋律拉长、滑着走
        long: "!bend!A3 (c2 d) !vib!e6 | (d2 c) (c B2) A6 | (c2 d) (e2 g) !bend!a3 (g2 e) | (d2 e) (d2 c) (c B2) A3 | !vib!e3 a3 (g2 e) !vib!e3 | (d2 e) (d2 c) (c B2) A3 | !vib!E3 (A2 c) (d2 e) (d c B) | A3 !vib!E6 z3",
        // 玄琴：低音区砸根音（mi 弄弦，la 不揉）
        gk: "A,,3 z6 !vib!E,3 | D,3 z6 A,,3 | A,,3 z6 C,3 | !vib!E,3 z6 !vib!E,,3 | A,,3 z6 !vib!E,3 | D,3 z6 A,,3 | A,,3 z3 C,3 D,3 | A,,3 !vib!E,,6 z3",
        jg: "A,,12 | z12 | z12 | z12 | A,,12 | z12 | z12 | z12",
        jgf: rep("A,,12", 8),
      },
    },
    B: {
      bars: 8,
      // 转到 G 上的平调（G A C D E）。중모리：一个长短十二拍、每拍一个四分音符（2 个单位），占两小节（和弦两小节一组，每组落回 G）。
      // 旋律按四分音符的单拍写（两拍、四拍一组，不按附点四分音符分句）：前六拍起句，第九拍（第二小节的第三拍）落到长音、拖到第十二拍；
      // 应答的一句放在这个长音里（第十到十二拍）。揉 re 与 sol，mi 只是经过。
      chords: "G5 | G5 | C5 | G5 | C5 | G5 | D5 | G5",
      lines: {
        bmel: "G2 A2 c4 (d e) d2 | c2 A2 !vib!d8 | e4 (g e) d2 c2 A2 | c2 A2 G8 | c4 (d e) g4 a2 | g2 e2 !vib!d8 | e2 (d c) A2 G2 A2 c2 | d2 (c A) !vib!G6 z2",
        resp: "z12 | z6 a2 !vib!g4 | z12 | z6 e2 !vib!d4 | z12 | z6 !bend!a6 | z12 | z4 !vib!g6 z2",
        // 玄琴：第一拍、第五拍与第九拍（长短里“덩”落的地方）
        gb: "G,,4 z4 D,4 | z4 G,,8 | C,4 z4 G,,4 | z4 G,,8 | C,4 z4 G,,4 | z4 D,8 | D,4 z4 A,,4 | z4 !vib!G,,6 z2",
      },
    },
    coda: {
      bars: 2,
      chords: "A5 | A5",
      lines: {
        end: "[A,E]3 A3 !vib!E6 | z12",
        jg: "A,,12 | z12",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:daegeum gl:gayageum jg:jing janggu.intro pad", dyn: 0.64, tempo: 0.7 },
      { s: "A", play: "mel:gayageum jg:jing janggu.gut buk.gut low pad", dyn: 0.66 },
      { s: "B", play: "bmel:haegeum resp:daegeum gb:geomungo janggu.jung buk.jung low pad", dyn: 0.62, tempo: 0.88 },
      { s: "A", play: "mel:taep long:piri jgf:jing janggu.jajin buk.jajin kkwaeng low pad", dyn: 0.74, tempo: 1.4 },
      { s: "coda", play: "end:gayageum jg:jing janggu.coda buk.coda low", dyn: 0.74, rit: 0.85 },
    ],
    [
      { s: "A", play: "mel:gayageum long:haegeum gk:geomungo jg:jing janggu.gut buk.gut low pad", dyn: 0.66 },
      { s: "B", play: "bmel:daegeum resp:haegeum gb:geomungo janggu.jung buk.jung low pad", dyn: 0.62, tempo: 0.88 },
      { s: "A", play: "mel:taep long:piri jgf:jing janggu.jajin buk.jajin kkwaeng low pad", dyn: 0.74, tempo: 1.4 },
      { s: "coda", play: "end:gayageum jg:jing janggu.coda buk.coda low", dyn: 0.74, rit: 0.85 },
    ],
  ],
  rest: [10, 18],
  level: 1.38,
};
