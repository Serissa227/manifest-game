// 《潟湖的鼓声》：太平洋岛民的港口（寰宇·十六世纪的数据里是塔希提的马塔瓦伊湾与关岛的查莫罗村落——双体独木舟靠在潟湖里，
// 岸上是棕榈叶的屋顶与跳舞的场子）。地方特色第二阶段新写：太平洋的乐器领奏（复古合成版的衬底只有很轻的合成持续音与低音）。旋律原创。
// 调式：D 上的无半音的几个音（D E G A C，偶尔高处的 d e；不用 F 与 B）——像吟诵（oli、mele）那样在一两个音上反复念，
// 句尾往下落；和声不用西洋的三和弦，只有空五度的持续音（D5、G5、A5、C5）。每分钟 100 拍，4/4：
// - 引子：普（海螺号）吹两声长的（第二声吹上去五度），帕胡鼓（鲨皮鼓）在空当里“嘣 · · 帕”地应，普纽膝鼓点几下；
// - A：呼拉（hula ʻālaʻapapa）：伊普双葫芦打 kāholo 的“库 · 帕帕”，鼻笛像吟诵一样念旋律，乌克克口弓也照“长 短短”拨着两根弦；
//   鼻笛只有两三个孔，**只吹相邻的四个音（D E G A）**，在 A 上念、落到 D；高处的那一句（c d）交给口弓答（第五、六小节，嘴腔选出的泛音）；
//   再一遍乌利乌利羽毛沙铃、顿竹筒（D 与 A 两根）加进来；
// - B：奥特阿（ʻōteʻa，塔希提的鼓舞），速度提到 1.25 倍：帕特 / 托埃雷两只裂缝鼓一只敲缝心、一只敲两头，咬合成不停的十六分音符，
//   帕胡鼓踩拍，法阿特特小鼓（塔希提）只敲 3 + 3 + 2 的重音横过来，顿竹筒在下面；再一遍普在上面吹长音，法阿特特改成一条不停的八分音符（重音仍是 3 + 3 + 2）；
// - C（第二遍）：潟湖的夜：口弓与鼻笛一问一答（鼻笛照旧只用 D E G A），伊利伊利卵石轻轻点，
//   马里亚纳查莫罗人的贝伦巴奥图延葫芦弓在低处敲一根弦（“长 短短”，跟着空五度的根走）；
// - 尾声：裂缝鼓一阵滚奏，法阿特特敲完 3 + 3 + 2，帕胡鼓收，普的最后一声往下落。
// 用这首的港口（data/worlds/terra16 里）只有塔希提（波利尼西亚势力）与关岛（查莫罗势力）：A 段的呼拉是泛波利尼西亚的颜色（塔希提也有鼻笛 vivo），
// B 段的奥特阿是塔希提的（托埃雷、法阿特特、帕胡鼓），C 段给关岛的查莫罗人留了葫芦弓。数据里没有美拉尼西亚的港口，也没有斐济、汤加的港口，
// 所以不用美拉尼西亚的昆杜，也不用斐济、汤加的拉利木鼓（这两件留在乐器库里，等有那边的港口再用）。
import type { TrackDef } from "../score";

/** 口弓的两根弦：拨“长 短短 长 长”（与伊普的“库 · 帕帕”同一个呼吸）；chord 为这一小节的根（写的是嘴腔选出的泛音，弦在下面两个八度）。 */
const strum = (roots: readonly (readonly [string, string])[]) => roots.map(([a, b]) => `${a}2 ${b} ${a} ${a}2 ${b}2`).join(" | ");

/** 顿竹筒：两根（D 与下方四度的 A）一高一低，每拍一下。 */
const tubes = (bars: number) => Array.from({ length: bars }, () => "D,2 A,,2 D,2 A,,2").join(" | ");

export const PORT_POLYNESIA: TrackDef = {
  id: "port_polynesia",
  title: { zh: "潟湖的鼓声", en: "Drums across the Lagoon" },
  qpm: 100,
  meter: [4, 4],
  key: "D mixolydian",
  voices: {
    flute: { inst: "ohe_hano", gain: 0.62, pan: -0.12, reverb: 0.38 },
    pu: { inst: "pu", gain: 0.4, pan: 0.06, reverb: 0.55 },
    ukeke: { inst: "ukeke", gain: 0.42, pan: 0.24, reverb: 0.3 },
    // 查莫罗的葫芦弓（第二遍的夜里）
    bow: { inst: "belembaotuyan", gain: 0.44, pan: -0.26, reverb: 0.34 },
    tubes: { inst: "kaekeeke", gain: 0.4, pan: -0.22, reverb: 0.24 },
    ipu: { inst: "perc", gain: 0.34, pan: 0.16, reverb: 0.24, pattern: { kind: "drum", steps: "K.PPK.PPK.PPKKP.", hits: { K: ["ipu_ku", 0.85], P: ["ipu_pa", 0.62] } } },
    uliuli: { inst: "perc", gain: 0.2, pan: -0.32, reverb: 0.22, pattern: { kind: "drum", steps: "S.s.S.s.S.s.S.W.", hits: { S: ["uliuli", 0.6], s: ["uliuli", 0.35], W: ["uliuli_swish", 0.5] } } },
    ilili: { inst: "perc", gain: 0.18, pan: 0.34, reverb: 0.26, pattern: { kind: "drum", grid: 0.5, steps: "i...i.i.i...i.ii", hits: { i: ["ilili", 0.55] } } },
    pahu: {
      inst: "perc",
      gain: 0.34,
      pan: 0.02,
      reverb: 0.36,
      pattern: {
        // 引子：海螺号的两声之后应答
        intro: { kind: "drum", steps: "........D...D.p.........D.p.D...", hits: { D: ["pahu_nui", 0.85], p: ["pahu_pa", 0.6] } },
        // 奥特阿：踩拍（十六分音符的格子）
        b: { kind: "drum", grid: 0.5, steps: "D...p...D...p.D.", hits: { D: ["pahu_nui", 0.8], p: ["pahu_pa", 0.55] } },
        coda: { kind: "drum", grid: 0.5, steps: "D.......D...D.D.D...............", hits: { D: ["pahu_nui", 0.9] } },
      },
    },
    puniu: {
      inst: "perc",
      gain: 0.22,
      pan: -0.16,
      reverb: 0.28,
      pattern: {
        intro: { kind: "drum", steps: "..........x...x...........x.x.xx", hits: { x: ["puniu", 0.7] } },
      },
    },
    // 两只裂缝鼓咬合：一只敲缝心（托），一只敲两头（迪），合起来是不停的十六分音符
    pate1: {
      inst: "perc",
      gain: 0.28,
      pan: -0.2,
      reverb: 0.24,
      pattern: {
        b: { kind: "drum", grid: 0.5, steps: "T.tT.tT.T.tT.ttt", hits: { T: ["pate", 0.85], t: ["pate", 0.55] } },
        coda: { kind: "drum", grid: 0.5, steps: "T.tT.tT.TtTtTtTtT...............", hits: { T: ["pate", 0.9], t: ["pate", 0.6] } },
      },
    },
    pate2: {
      inst: "perc",
      gain: 0.24,
      pan: 0.22,
      reverb: 0.24,
      pattern: {
        b: { kind: "drum", grid: 0.5, steps: ".h..h..h.h..h...", hits: { h: ["pate_hi", 0.6] } },
        coda: { kind: "drum", grid: 0.5, steps: ".h..h..h........................", hits: { h: ["pate_hi", 0.6] } },
      },
    },
    // 法阿特特小鼓（塔希提）：十六分音符的格子。第一遍奥特阿只敲 3 + 3 + 2 的重音（第 0、6、12 格），重音之间敲一下鼓边；
    // 带普的那一遍改成八分音符不停，重音仍在 3 + 3 + 2 上，每小节最后一下敲鼓边；尾声敲完一轮 3 + 3 + 2 再收一下
    faatete: {
      inst: "perc",
      gain: 0.26,
      pan: 0.3,
      reverb: 0.26,
      pattern: {
        b1: { kind: "drum", grid: 0.5, steps: "F...r.F...r.F...", hits: { F: ["faatete", 0.85], r: ["faatete_rim", 0.55] } },
        b: { kind: "drum", grid: 0.5, steps: "F.f.f.F.f.f.F.r.", hits: { F: ["faatete", 0.8], f: ["faatete", 0.45], r: ["faatete_rim", 0.6] } },
        coda: { kind: "drum", grid: 0.5, steps: "F...r.F...r.F...F...............", hits: { F: ["faatete", 0.9], r: ["faatete_rim", 0.6] } },
      },
    },
    // 衬底（合成）：很轻的空五度持续音与每小节一个根音
    pad: { inst: "drone", gain: 0.13, pan: -0.18, reverb: 0.44, pattern: { kind: "pad", low: 50, high: 69, size: 2 } },
    low: { inst: "celli", gain: 0.13, pan: 0.12, reverb: 0.28, pattern: { kind: "arp", low: 38, steps: "1 . . . . . . .", ring: 8 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "D5 | D5 | D5 | D5",
      lines: { call: "!bend!A,6 z2 | z8 | !bend!A,4 !bend!E4 | !fall!A,6 z2" },
    },
    A: {
      bars: 8,
      chords: "D5 | D5 | G5 | A5 | D5 | C5 | G5 | D5",
      lines: {
        // 像吟诵：鼻笛只用相邻的四个音（D E G A），在 A 上反复念，长音揉开（ʻiʻi），句尾往下落；第五、六小节让给口弓
        mel: "A2 A A !vib!A3 G | A2 G A !vib!E4 | G2 G A G E D2 | !vib!E6 z2 | z8 | z8 | E2 G E D2 E D | !fall!D6 z2",
        // 口弓：照旧拨两根弦，第五、六小节答高处的那一句（c d，嘴腔选出的泛音），再回去拨弦
        uk: [strum([["d", "A"], ["d", "A"], ["g", "d"], ["a", "e"]]), "c2 c d c A G A | c4 A2 G2", strum([["g", "d"], ["d", "A"]])].join(" | "),
        tb: tubes(8),
      },
    },
    B: {
      bars: 8,
      chords: "D5 | D5 | D5 | D5 | A5 | A5 | G5 | D5",
      lines: {
        tb: tubes(8),
        // 海螺号在鼓上面拉长音（基本只有一个音，偶尔吹上去五度）
        horn: "!bend!A,8- | A,4 z4 | !bend!A,8- | A,4 z4 | !bend!E8- | E4 z4 | !bend!A,8 | !fall!A,6 z2",
      },
    },
    C: {
      bars: 8,
      chords: "G5 | G5 | D5 | D5 | C5 | G5 | A5 | D5",
      lines: {
        // 口弓问、鼻笛答（鼻笛只用 D E G A）
        ukm: "g2 a g e2 d2 | e4 z4 | z8 | z8 | c2 d c A2 G2 | A4 z4 | z8 | z8",
        flr: "z8 | z4 !bend!A4 | !vib!G6 E2 | D8 | z8 | z4 !bend!G4 | A2 G2 E2 G2 | !fall!D8",
        // 葫芦弓：低处一根弦，木棍敲“长 短短”，手指按弦换到空五度的另一个音
        bw: "G,,2 z G,, D,2 z2 | G,,2 z G,, D,2 z2 | D,2 z D, A,,2 z2 | D,2 z D, A,,2 z2 | C,2 z C, G,,2 z2 | G,,2 z G,, D,2 z2 | A,,2 z A,, E,2 z2 | D,4 z4",
      },
    },
    coda: { bars: 2, chords: "D5 | D5", lines: { end: "z4 !bend!A,4- | !fall!A,6 z2" } },
  },
  forms: [
    [
      { s: "intro", play: "call:pu pahu.intro puniu.intro pad", dyn: 0.62, to: 0.68 },
      { s: "A", play: "mel:flute uk:ukeke ipu pad low", dyn: 0.64 },
      { s: "A", play: "mel:flute uk:ukeke tb:tubes ipu uliuli pad low", dyn: 0.68 },
      { s: "B", play: "tb:tubes pate1.b pate2.b pahu.b faatete.b1 pad", dyn: 0.7, tempo: 1.25 },
      { s: "B", play: "horn:pu tb:tubes pate1.b pate2.b pahu.b faatete.b pad", dyn: 0.74, tempo: 1.25 },
      { s: "A", play: "mel:flute uk:ukeke ipu uliuli pad low", dyn: 0.66, rit: 0.92 },
      { s: "coda", play: "end:pu pate1.coda pate2.coda pahu.coda faatete.coda", dyn: 0.74, tempo: 1.25 },
    ],
    [
      { s: "C", play: "ukm:ukeke flr:flute bw:bow ilili pad", dyn: 0.6 },
      { s: "A", play: "mel:flute uk:ukeke tb:tubes ipu uliuli pad low", dyn: 0.66 },
      { s: "B", play: "horn:pu tb:tubes pate1.b pate2.b pahu.b faatete.b pad", dyn: 0.72, tempo: 1.25 },
      { s: "coda", play: "end:pu pate1.coda pate2.coda pahu.coda faatete.coda", dyn: 0.72, tempo: 1.25 },
    ],
  ],
  rest: [10, 18],
  level: 1.2,
};
