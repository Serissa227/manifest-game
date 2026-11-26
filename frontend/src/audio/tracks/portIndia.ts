// 《棉布与靛蓝的码头》：印度的港口——按势力细分以后主要是古吉拉特与孟加拉（苏拉特、坎贝、达曼、吉大港、胡格利……棉布、靛蓝与硝石的码头）；
// 马拉巴尔（卡利卡特、科钦）放《豆蔻山下的港》，莫卧儿与德干的宫廷放《红砂岩的宫廷》（寰宇的数据写 malabar、mughal、deccan……，见 zones.ts 的 PORT_STYLE_TRACK）。
// 风格名只写 indian 的印度港口（寰宇里是古吉拉特与孟加拉）放这一首。
// 地方特色第一阶段重编：地方乐器领奏（复古合成版的衬底只有很轻的合成弦乐长音）。
// 萨 = D 的卡玛吉拉格（D E 升F G A B C，上行时 C 也升：轻快、白天的拉格），凯赫尔瓦塔拉（八拍一轮：Dha Ge Na Ti | Na Ke Dhi Na），每分钟 96 拍；
// 写成北印度器乐的一小段“阿拉普—加特—安塔拉—贾拉—提哈伊”：
// - 阿拉普：只有坦布拉的“五 — 一 — 一 — 低一”与西塔琴，滑音（meend）一个一个地把拉格的音摸出来，不打塔布拉；
// - 加特：西塔琴弹固定的曲调，塔布拉进来打凯赫尔瓦；再一遍班苏里高八度接过来，桑图尔叮叮地铺；
// - 安塔拉：班苏里到高音区（第二遍换成谢赫奈）；
// - 贾拉：西塔琴旋律音与高音的“齐卡里”弦交替地快弹，塔布拉加倍；
// - 提哈伊：一句短句连奏三遍，第三遍的最后一个音正好落在下一轮的第一拍（萨姆）上。
// 印度古典音乐没有和声：底下只有坦布拉的持续音（D–A）。
import type { TrackDef } from "../score";

export const PORT_INDIA: TrackDef = {
  id: "port_india",
  title: { zh: "棉布与靛蓝的码头", en: "Quays of Cotton and Indigo" },
  qpm: 96,
  meter: [4, 4],
  key: "D mixolydian",
  voices: {
    sitar: { inst: "sitar", gain: 0.58, pan: -0.12, reverb: 0.28 },
    bansuri: { inst: "bansuri", gain: 0.5, pan: 0.16, reverb: 0.38 },
    shehnai: { inst: "shehnai", gain: 0.4, pan: 0.1, reverb: 0.32 },
    santoor: { inst: "santoor", gain: 0.22, pan: 0.32, reverb: 0.32, pattern: { kind: "arp", low: 50, steps: "1 5 8 5 12 8 5 8", ring: 2 } },
    tanpura: { inst: "tanpura", gain: 0.34, pan: -0.26, reverb: 0.36, pattern: { kind: "arp", low: 50, steps: "5, . . . 8 . . . 8 . . . 1 . . .", ring: 4 } },
    tabla: {
      inst: "perc",
      gain: 0.32,
      pan: 0.1,
      reverb: 0.22,
      pattern: {
        theka: { kind: "drum", steps: "n.ntn.in", hits: { n: ["tabla_na", 0.7], t: ["tabla_te", 0.55], i: ["tabla_tin", 0.65] } },
        fast: { kind: "drum", steps: "ntnininn", hits: { n: ["tabla_na", 0.7], t: ["tabla_te", 0.55], i: ["tabla_tin", 0.6] } },
        tihai: { kind: "drum", steps: "...nnnn.nnnn.nnnn.......", hits: { n: ["tabla_na", 0.8] } },
      },
    },
    bayan: {
      inst: "perc",
      gain: 0.3,
      pan: 0.02,
      reverb: 0.22,
      pattern: {
        theka: { kind: "drum", steps: "GG...KG.", hits: { G: ["bayan_ge", 0.7], K: ["bayan_ke", 0.55] } },
        fast: { kind: "drum", steps: "G.G.K.G.", hits: { G: ["bayan_go", 0.7], K: ["bayan_ke", 0.55] } },
        tihai: { kind: "drum", steps: "...G....G....G..G.......", hits: { G: ["bayan_ge", 0.85] } },
      },
    },
    // 衬底（合成）：很轻的弦乐长音（D–A），大提琴组的低音 D
    pad: { inst: "strings", gain: 0.16, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 57, high: 74, size: 2 } },
    low: { inst: "celli", gain: 0.14, pan: 0.12, reverb: 0.3, pattern: { kind: "arp", low: 38, steps: "1 . . . . . . .", ring: 8 } },
  },
  sections: {
    alap: { bars: 4, chords: "D5 | D5 | D5 | D5", lines: { call: "D4 z2 !bend!F2 | !bend!G4 !vib!A4 | z2 B2 A G !bend!F2 | !vib!D8" } },
    gat: {
      bars: 8,
      chords: "D5 | D5 | D5 | D5 | D5 | D5 | D5 | D5",
      lines: { mel: "A,2 D F G2 A2 | B A G F !bend!G4 | A B ^c d2 =c B A | !vib!B6 A2 | d2 =c B A2 G F | G F E D !bend!F4 | E D E F G2 F E | D8" },
    },
    antara: {
      bars: 8,
      chords: "D5 | D5 | D5 | D5 | D5 | D5 | D5 | D5",
      lines: { bmel: "d2 e f g2 a2 | a b a g !vib!a4 | b a g f g2 f e | !bend!f6 e2 | d2 ^c d e2 =c B | A B =c d !vib!B4 | A G F G A2 G F | D8" },
    },
    jhala: {
      bars: 4,
      chords: "D5 | D5 | D5 | D5",
      lines: { jh: "F d d G d d A d | B d d A d d G d | A d d B d d ^c d | d' d d =c' d d B d" },
    },
    tihai: {
      bars: 3,
      chords: "D5 | D5 | D5",
      lines: { ti: "z3 G F E D z | G F E D z G F E | D8" },
    },
  },
  forms: [
    [
      { s: "alap", play: "call:sitar tanpura", dyn: 0.6 },
      { s: "gat", play: "mel:sitar tanpura tabla.theka bayan.theka low", dyn: 0.66 },
      { s: "gat", play: "mel:bansuri+12 mel:sitar santoor tanpura tabla.theka bayan.theka low", dyn: 0.68 },
      { s: "antara", play: "bmel:bansuri santoor tanpura tabla.theka bayan.theka low pad", dyn: 0.7 },
      { s: "jhala", play: "jh:sitar tanpura tabla.fast bayan.fast low", dyn: 0.74 },
      { s: "tihai", play: "ti:sitar ti:bansuri+12 tanpura tabla.tihai bayan.tihai low", dyn: 0.76, rit: 0.94 },
    ],
    [
      { s: "gat", play: "mel:sitar santoor tanpura tabla.theka bayan.theka low", dyn: 0.66 },
      { s: "antara", play: "bmel:shehnai tanpura tabla.theka bayan.theka low pad", dyn: 0.7 },
      { s: "jhala", play: "jh:sitar santoor tanpura tabla.fast bayan.fast low", dyn: 0.74 },
      { s: "tihai", play: "ti:sitar ti:shehnai+12 tanpura tabla.tihai bayan.tihai low", dyn: 0.76, rit: 0.94 },
    ],
  ],
  rest: [10, 18],
  level: 1.2,
};
