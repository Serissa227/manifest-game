// 《上元灯市》：养成篇的节日·明（元宵的灯市：鳌山灯、走马灯、猜灯谜，女伴结队夜里“走桥”）。旋律原创。
// 第二阶段（东亚宫廷）：主角是明的文化区时（养成摘要的 culture），节日放这一首代替《节日的街》。
// D 宫五声（D E 升F A B），4/4（每分钟 126 拍），旋律用“鱼咬尾”（两小节一句，下一句从上一句的尾音起——A、B 两段句句相咬，测试查）：
// - 引子：锣鼓开场——板鼓领起，堂鼓滚、大锣“匡”、铙钹“才”，小锣“台”；
// - A：梆笛高八度领奏（笛膜的沙、倚音），扬琴分解，笙的和音，小锣点在第二、四拍、堂鼓轻轻地走；
// - A′：唢呐领、梆笛与二胡同奏（民间的“吹打”），锣鼓全上；
// - B：灯下走桥——慢下来，大笛唱一段柔的，云锣在每小节的头上点出骨干，琵琶低八度轮指，拍板打“板”；
// - A″：全体，尾声锣鼓收“匡 才 匡 · | 匡——”。
// 和声只用五声音阶里的空五度（笙的和音），不写西洋的三和弦。
import type { TrackDef } from "../score";

export const UB_LANTERN: TrackDef = {
  id: "ub_lantern",
  title: { zh: "上元灯市", en: "Lantern Market at Shangyuan" },
  qpm: 126,
  meter: [4, 4],
  key: "D major",
  level: 1.12,
  voices: {
    di: { inst: "bangdi", gain: 0.4, pan: -0.14, reverb: 0.3 },
    suona: { inst: "suona", gain: 0.36, pan: -0.04, reverb: 0.3 },
    erhu: { inst: "erhu", gain: 0.42, pan: 0.14, reverb: 0.3 },
    dadi: { inst: "dadi", gain: 0.5, pan: -0.16, reverb: 0.42 },
    pipa: { inst: "pipa", gain: 0.4, pan: 0.24, reverb: 0.32 },
    yunluo: { inst: "yunluo", gain: 0.22, pan: -0.3, reverb: 0.46 },
    yangqin: { inst: "yangqin", gain: 0.22, pan: 0.32, reverb: 0.3, pattern: { kind: "arp", low: 50, steps: "1 5 8 5 12 8 5 8", ring: 2 } },
    sheng: { inst: "sheng", gain: 0.18, pan: -0.26, reverb: 0.38, pattern: { kind: "pad", low: 62, high: 79, size: 3 } },
    xiaoluo: { inst: "xiaoluo", gain: 0.18, pan: 0.28, reverb: 0.3 },
    daluo: { inst: "daluo", gain: 0.24, pan: -0.06, reverb: 0.42 },
    bangu: {
      inst: "perc",
      gain: 0.2,
      pan: 0.12,
      reverb: 0.24,
      pattern: { intro: { kind: "drum", steps: "b.b.bbbbb.b.b...", hits: { b: ["bangu", 0.8] } }, a: { kind: "drum", steps: "b..b..b.", hits: { b: ["bangu", 0.5] } } },
    },
    tanggu: {
      inst: "perc",
      gain: 0.28,
      pan: 0.04,
      reverb: 0.3,
      pattern: {
        intro: { kind: "drum", steps: "T.T.TTTT........", hits: { T: ["tanggu", 0.8] } },
        a: { kind: "drum", steps: "T...t.t.", hits: { T: ["tanggu", 0.62], t: ["tanggu", 0.36] } },
        full: { kind: "drum", steps: "T.tTT.tT", hits: { T: ["tanggu", 0.8], t: ["tanggu", 0.46] } },
        coda: { kind: "drum", steps: "T.T.T...T.......", hits: { T: ["tanggu", 0.9] } },
      },
    },
    bo: {
      inst: "perc",
      gain: 0.2,
      pan: 0.18,
      reverb: 0.32,
      pattern: {
        intro: { kind: "drum", steps: "....C...C.C.C...", hits: { C: ["bo", 0.75] } },
        full: { kind: "drum", steps: "..C...C.", hits: { C: ["bo", 0.58] } },
        coda: { kind: "drum", steps: ".C.C............", hits: { C: ["bo", 0.8] } },
      },
    },
    ban: { inst: "perc", gain: 0.2, pan: -0.2, reverb: 0.3, pattern: { kind: "drum", steps: "P.......", hits: { P: ["paiban", 0.62] } } },
    // 衬底（合成）：拨奏的低音
    bass: { inst: "pizz", gain: 0.3, pan: 0.06, reverb: 0.16, pattern: { kind: "arp", low: 38, steps: "1 . . . 5, . . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "D5 | D5",
      lines: {
        gong: "G,2 z2 G,2 z2 | G, z G, z G,2 z2",
        luo: "z2 f2 z2 f2 | z4 f2 z2",
      },
    },
    A: {
      bars: 8,
      chords: "D5 | A5 | D5 | A5 | B5 | E5 | A5 | D5",
      lines: {
        mel: "d2 e/2d/2B A2 B d | e2 {f}e d B2 A B | B2 d2 e/2f/2e/2d/2 B2 | A2 B A F4 | F2 A B d2 e2 | f e d e f2 a2 | a2 f/2e/2d/2B/2 A2 B d | d6 z2",
        // 二胡：同一条旋律，滑着走
        hu: "(d2 e/2d/2B) A2 (B d) | !vib!e2 (e d) B2 (A B) | (B2 d2) (e/2f/2e/2d/2) B2 | !bend!A2 (B A) !vib!F4 | F2 (A B) d2 !bend!e2 | (f e d e) f2 !vib!a2 | !vib!a2 (f/2e/2d/2B/2) A2 (B d) | !vib!d6 z2",
        luo: "z2 f2 z2 f2 | z2 f2 z2 f2 | z2 f2 z2 f2 | z2 f2 z2 f2 | z2 f2 z2 f2 | z2 f2 z2 f2 | z2 f2 z2 f2 | z2 f2 z4",
        gong: "G,4 z4 | z8 | z8 | z8 | G,4 z4 | z8 | z8 | z8",
      },
    },
    B: {
      bars: 8,
      chords: "A5 | E5 | B5 | A5 | B5 | A5 | A5 | D5",
      lines: {
        bmel: "A4 B2 d2 | e3 f e2 d2 | d2 B2 A2 F2 | E6 z2 | E2 F A B2 d2 | e4 d2 B2 | B2 A2 F2 E2 | D6 z2",
        // 大笛（曲笛一族里最低的一支）：倚音与上滑、慢揉
        qmel: "!bend!A4 B2 d2 | e3 {a}f e2 d2 | !vib!d2 B2 A2 F2 | !vib!E6 z2 | E2 F A {d}B2 d2 | !bend!e4 d2 B2 | !vib!B2 A2 F2 E2 | !vib!D6 z2",
        // 云锣：每小节头上的骨干音
        yl: "a4 z4 | e'4 z4 | d'4 z4 | e4 z4 | e4 z4 | e'4 z4 | b4 z4 | d4 z4",
      },
    },
    coda: {
      bars: 2,
      chords: "D5 | D5",
      lines: {
        end: "d2 z2 [DAd]2 z2 | z8",
        gong: "G,2 z G, G,2 z2 | G,4 z4",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "gong:daluo luo:xiaoluo bangu.intro tanggu.intro bo.intro", dyn: 0.72 },
      { s: "A", play: "mel:di+12 yangqin sheng luo:xiaoluo bangu tanggu bass", dyn: 0.66 },
      { s: "A", play: "mel:suona mel:di+12 hu:erhu yangqin sheng luo:xiaoluo gong:daluo bangu tanggu.full bo.full bass", dyn: 0.72 },
      { s: "B", play: "qmel:dadi yl:yunluo bmel:pipa-12 sheng ban bass", dyn: 0.6, tempo: 0.86 },
      { s: "A", play: "mel:suona mel:di+12 hu:erhu yangqin sheng luo:xiaoluo gong:daluo bangu tanggu.full bo.full bass", dyn: 0.76 },
      { s: "coda", play: "end:pipa gong:daluo tanggu.coda bo.coda", dyn: 0.78, rit: 0.9 },
    ],
    [
      { s: "A", play: "hu:erhu yangqin sheng luo:xiaoluo tanggu bass", dyn: 0.64 },
      { s: "B", play: "qmel:dadi yl:yunluo bmel:pipa-12 sheng ban bass", dyn: 0.6, tempo: 0.86 },
      { s: "A", play: "mel:suona mel:di+12 hu:erhu yangqin sheng luo:xiaoluo gong:daluo bangu tanggu.full bo.full bass", dyn: 0.76 },
      { s: "coda", play: "end:pipa gong:daluo tanggu.coda bo.coda", dyn: 0.78, rit: 0.9 },
    ],
  ],
  rest: [8, 14],
};
