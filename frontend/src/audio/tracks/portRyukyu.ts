// 《红瓦与三线》：琉球的港口（那霸、泊、运天……红瓦屋顶、石垣与福木，朝贡船与南洋来的船都在这里换货）。
// 地方特色第二阶段：地方乐器领奏（复古合成版的衬底用合成的持续音与大提琴组）。
// C 上的琉球音阶（C E F G B：没有 D 与 A，E–F、B–C 两个半音是它一听就知道的颜色），6/8 拍（每分钟 104 个四分音符），
// 先是一首抒情的民谣，再跳成“カチャーシー”：
// - 引子：三线自弹自唱一样的一句（慢、自由），胡弓从下面滑进来；
// - A（十六小节的民谣）：三线领奏，手鼓轻轻点、三板在后半拍“咔”；后八小节胡弓跟着同一条旋律拉（异音齐奏）；
// - B（カチャーシー，快六成）：三线弹快的一段，エイサー的大太鼓“咚 · 咔 咚 · 咔”、缔太鼓、手鼓、三板的碎拍子一起上；
//   再一遍胡弓也跟上，旁边的人吹指笛“咻——”地起哄；
// - 尾声：三线一扫、大太鼓三下。
// 不写西洋的三和弦：衬底只有空五度的持续音（C–G，偶尔 E–B、F–C），三个五度的音都在音阶里；
// 不用 G–D——D 不在琉球音阶里，而且 G–D 垫在“B G F E → C”底下会凑成属七解决到主和弦的西洋终止。
import type { TrackDef } from "../score";

export const PORT_RYUKYU: TrackDef = {
  id: "port_ryukyu",
  title: { zh: "红瓦与三线", en: "Red Tiles and Sanshin" },
  qpm: 104,
  meter: [6, 8],
  key: "C major",
  voices: {
    sanshin: { inst: "sanshin", gain: 0.62, pan: -0.12, reverb: 0.26 },
    kucho: { inst: "kucho", gain: 0.44, pan: 0.18, reverb: 0.32 },
    fue: { inst: "yubibue", gain: 0.12, pan: 0.34, reverb: 0.4 },
    eisa: {
      inst: "perc",
      gain: 0.32,
      pan: 0.04,
      reverb: 0.3,
      pattern: {
        k: { kind: "drum", steps: "D.rD.r", hits: { D: ["eisa_don", 0.85], r: ["eisa_rim", 0.5] } },
        k2: { kind: "drum", steps: "D.rD.rD.rDDr", hits: { D: ["eisa_don", 0.9], r: ["eisa_rim", 0.55] } },
        coda: { kind: "drum", steps: "D..D..D.....", hits: { D: ["eisa_don", 0.95] } },
      },
    },
    shime: { inst: "perc", gain: 0.2, pan: -0.2, reverb: 0.26, pattern: { kind: "drum", steps: "S.sS.s", hits: { S: ["shime", 0.65], s: ["shime", 0.38] } } },
    paranku: {
      inst: "perc",
      gain: 0.3,
      pan: 0.24,
      reverb: 0.3,
      pattern: {
        a: { kind: "drum", steps: "P.....p.....", hits: { P: ["paranku", 0.6], p: ["paranku", 0.4] } },
        k: { kind: "drum", steps: "P.pP.p", hits: { P: ["paranku", 0.8], p: ["paranku", 0.5] } },
      },
    },
    sanba: {
      inst: "perc",
      gain: 0.3,
      pan: -0.3,
      reverb: 0.28,
      pattern: {
        a: { kind: "drum", steps: "..x..x", hits: { x: ["sanba", 0.5] } },
        k: { kind: "drum", grid: 0.5, steps: "x..xx.x..xx.", hits: { x: ["sanba", 0.7] } },
        coda: { kind: "drum", steps: "R...........", hits: { R: ["sanba_roll", 0.8] } },
      },
    },
    // 衬底（合成）：空五度的持续音、大提琴组的长音
    pad: { inst: "drone", gain: 0.17, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 52, high: 71, size: 2 } },
    low: { inst: "celli", gain: 0.17, pan: 0.12, reverb: 0.26, pattern: { kind: "arp", low: 43, steps: "1 . . . . .", ring: 6 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "C5 | C5 | C5 | C5",
      lines: {
        ss: "C3 E2 F | G3 {c}B2 G | F2 E C2 E | C6",
        ki: "z6 | z6 | !bend!F3 E3 | !vib!C6",
      },
    },
    A: {
      bars: 16,
      chords: "C5 | E5 | C5 | C5 | C5 | F5 | E5 | C5 | C5 | F5 | C5 | C5 | C5 | C5 | E5 | C5",
      lines: {
        mel: "C2 E F2 G | B2 c G3 | F2 G E2 C | E3 {F}E3 | G2 B c2 e | f2 e c3 | B2 G F2 E | C6 | G2 B c2 e | f2 e c3 | e2 c B2 G | c3 B2 G | F2 G E2 F | G2 E C3 | E2 F G2 B | c6",
        // 胡弓的异音：前八小节不拉，后八小节同一条旋律拉长、滑着走
        kl: "z6 | z6 | z6 | z6 | z6 | z6 | z6 | z6 | (G2 B) (c2 e) | !bend!f3 (e2 c) | (e2 c) !vib!B3 | !vib!c6 | (F2 G) (E2 F) | !vib!G3 (E2 C) | (E2 F) (G2 B) | !vib!c6",
        // 胡弓领奏时（第二遍）：整首都拉
        kf: "!bend!C3 (F2 G) | !vib!B3 (c2 G) | (F2 G) (E2 C) | !vib!E6 | (G2 B) (c2 e) | !bend!f3 (e2 c) | (B2 G) (F2 E) | !vib!C6 | (G2 B) (c2 e) | !bend!f3 (e2 c) | (e2 c) !vib!B3 | !vib!c6 | (F2 G) (E2 F) | !vib!G3 (E2 C) | (E2 F) (G2 B) | !vib!c6",
      },
    },
    B: {
      bars: 16,
      chords: "C5 | C5 | C5 | C5 | C5 | E5 | C5 | C5 | C5 | C5 | C5 | F5 | C5 | C5 | E5 | C5",
      lines: {
        kc: "c2 c B2 G | F G E2 C2 | E2 F G2 B | c2 B c3 | e2 f e2 c | B2 c G3 | F2 G E2 F | C3 z3 | G2 c B2 G | F2 G E2 C | E2 G c2 e | f2 e c3 | e2 c B2 G | F2 E C3 | E2 F G2 B | c3 z3",
        // 指笛的“咻”也只落在音阶里的音（c''、g'），不吹音阶外的 A
        wh: "z6 | z6 | z6 | z3 !bend!c''3 | z6 | z6 | z6 | z6 | z6 | z6 | z6 | z3 !bend!g'3 | z6 | z6 | !bend!g'2 z !bend!g'2 z | !bend!c''3 z3",
      },
    },
    coda: {
      bars: 2,
      chords: "C5 | C5",
      lines: {
        end: "c2 B G2 E | [C,G,C]3 z3",
        wh: "z6 | !bend!c''3 z3",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "ss:sanshin ki:kucho pad", dyn: 0.58, tempo: 0.8 },
      { s: "A", play: "mel:sanshin kl:kucho paranku.a sanba.a low pad", dyn: 0.64 },
      { s: "B", play: "kc:sanshin eisa.k shime paranku.k sanba.k low pad", dyn: 0.72, tempo: 1.6 },
      { s: "B", play: "kc:sanshin kc:kucho wh:fue eisa.k2 shime paranku.k sanba.k low pad", dyn: 0.76, tempo: 1.6 },
      { s: "coda", play: "end:sanshin wh:fue eisa.coda sanba.coda low", dyn: 0.76, tempo: 1.6, rit: 0.8 },
    ],
    [
      { s: "A", play: "mel:sanshin kf:kucho paranku.a sanba.a low pad", dyn: 0.64 },
      { s: "B", play: "kc:sanshin eisa.k shime paranku.k sanba.k low pad", dyn: 0.72, tempo: 1.6 },
      { s: "B", play: "kc:sanshin kc:kucho wh:fue eisa.k2 shime paranku.k sanba.k low pad", dyn: 0.76, tempo: 1.6 },
      { s: "coda", play: "end:sanshin wh:fue eisa.coda sanba.coda low", dyn: 0.76, tempo: 1.6, rit: 0.8 },
    ],
  ],
  rest: [10, 18],
  level: 1.2,
};
