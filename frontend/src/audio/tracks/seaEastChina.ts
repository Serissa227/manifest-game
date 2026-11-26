// 《东海的季风》：东海与黄海（宁波双屿、舟山、长江口外到朝鲜与琉球之间的开阔海面）——第九批世界（terra16）的航海曲。
// 地方特色第二阶段（东亚宫廷）：经典世界东方海域的《瑶华季风》由地方乐器重编（旋律与段落同那一首；经典世界照旧放原来那首，一个音也没动）。
// D 宫五声（D E 升F A B），6/8 拍（每分钟 96 拍），像季风推着帆：
// - 引子：扬琴一串上行的刮奏、一声大锣，梆笛吹起帆动机（A → D → A，高八度）；
// - A：梆笛领奏（笛膜的沙、倚音与上滑音），扬琴分解，拍板与木鱼“嗒 · · 笃 · ·”；再来时扬琴低八度同奏，云锣在每小节的头上点出骨干；
// - B：琵琶唱（长音是轮指），大锣一声；再来时梆笛与琵琶低八度、第二遍二胡；尾声梆笛收、大锣一声。
// 和声只用五声音阶里的音搭成的空五度与挂留：D 空五度、D 挂二、B 挂四、E 挂四、A 挂四（笙的和音是四度、五度叠起来的），
// 扬琴的分解只走根音、五度、八度与挂留音——不写西洋的大小三和弦（10-11 复核：原来的 D 六和弦被笙的三个音截成 D 大三和弦、扬琴的“10”又弹出三音，改掉）。
import type { TrackDef } from "../score";

export const SEA_EAST_CHINA: TrackDef = {
  id: "sea_east_china",
  title: { zh: "东海的季风", en: "Monsoon on the East China Sea" },
  qpm: 96,
  meter: [6, 8],
  key: "D major",
  level: 1.26,
  voices: {
    di: { inst: "bangdi", gain: 0.44, pan: -0.12, reverb: 0.38 },
    pipa: { inst: "pipa", gain: 0.46, pan: 0.22, reverb: 0.34 },
    erhu: { inst: "erhu", gain: 0.42, pan: 0.14, reverb: 0.34 },
    yq: { inst: "yangqin", gain: 0.34, pan: 0.28, reverb: 0.38 },
    arp: { inst: "yangqin", gain: 0.2, pan: 0.32, reverb: 0.4, pattern: { kind: "arp", low: 50, steps: "1 5 8 5 10 8", ring: 3 } },
    yunluo: { inst: "yunluo", gain: 0.2, pan: -0.3, reverb: 0.5 },
    sheng: { inst: "sheng", gain: 0.2, pan: -0.25, reverb: 0.4, pattern: { kind: "pad", low: 62, high: 79, size: 3 } },
    gong: { inst: "daluo", gain: 0.24, pan: 0.1, reverb: 0.6 },
    clapper: { inst: "perc", gain: 0.24, pan: -0.2, reverb: 0.3, pattern: { kind: "drum", steps: "c..w..", hits: { c: ["paiban", 0.55], w: ["woodblock", 0.3] } } },
    // 衬底（合成）：拨奏的低音落在第一、四拍
    bass: { inst: "pizz", gain: 0.42, pan: 0.05, reverb: 0.15, pattern: { kind: "arp", low: 38, steps: "1 . . 5, . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "D5 | Asus4 | D5 | D5",
      lines: {
        // 扬琴的上行刮奏（五声音阶）
        gliss: "D/4E/4F/4A/4B/4d/4e/4f/4 z4 | z6 | z6 | z6",
        gong: "G,6 | z6 | z6 | z6",
        motif: "z6 | z4 A3/2 d/2 | !vib!a6 | z6",
      },
    },
    A: {
      bars: 8,
      chords: "D5 | Bsus4 | Esus4 | Asus4 | Dsus2 | Bsus4 | Asus4 | D5",
      lines: {
        mel: "f3 a2 b | a3 f3 | e3 f2 a | !slide!a6 | d'3 e'2 d' | b3 a2 f | e3 f2 e | d6",
        mel2: "{g}f3 a2 b | a3 {b}f3 | e3 f2 a | !bend!a6 | d'3 e'2 d' | {c'}b3 a2 f | e3 f2 e | !vib!d6",
        // 云锣：每小节头上的骨干音
        yl: "f3 z3 | a3 z3 | e3 z3 | a3 z3 | d'3 z3 | b3 z3 | e3 z3 | d3 z3",
      },
    },
    B: {
      bars: 8,
      chords: "Bsus4 | Esus4 | Dsus2 | Bsus4 | Esus4 | Asus4 | Bsus4 | D5",
      lines: {
        mel: "d3 f2 e | e3 d2 B | A3 B2 d | !slide!B6 | e3 f2 a | a3 f2 e | d3 B2 A | d6",
        // 二胡：同一条旋律，滑着走、揉弦
        hu: "(d3 f2 e) | !vib!e3 (d2 B) | !bend!A3 (B2 d) | !vib!B6 | (e3 f2) a | !vib!a3 (f2 e) | (d3 B2) A | !vib!d6",
        gong: "G,6 | z6 | z6 | z6 | z6 | z6 | z6 | z6",
      },
    },
    outro: {
      bars: 4,
      chords: "Bsus4 | Asus4 | D5 | D5",
      lines: {
        tag: "d3 B2 A | e3 f2 e | !vib!d6 | z6",
        gong: "z6 | z6 | G,6 | z6",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "gliss:yq gong:gong motif:di arp sheng", dyn: 0.56, to: 0.62 },
      { s: "A", play: "mel:di arp bass clapper", dyn: 0.62 },
      { s: "A", play: "mel2:di mel:yq-12 yl:yunluo arp sheng bass clapper", dyn: 0.66 },
      { s: "B", play: "mel:pipa gong:gong arp sheng bass clapper", dyn: 0.64 },
      { s: "B", play: "mel:di mel:pipa-12 arp sheng bass clapper", dyn: 0.68 },
      { s: "A", play: "mel2:di yl:yunluo arp sheng bass clapper", dyn: 0.7 },
      { s: "outro", play: "tag:di gong:gong arp sheng", dyn: 0.58, to: 0.38, rit: 0.85 },
    ],
    [
      { s: "intro", play: "gliss:yq gong:gong arp", dyn: 0.54, to: 0.6 },
      { s: "A", play: "mel:yq-12 arp bass", dyn: 0.6 },
      { s: "A", play: "mel:di arp sheng bass clapper", dyn: 0.64 },
      { s: "B", play: "mel:di gong:gong arp sheng bass clapper", dyn: 0.66 },
      { s: "B", play: "hu:erhu arp sheng bass clapper", dyn: 0.66 },
      { s: "A", play: "mel2:di mel:pipa-12 yl:yunluo arp sheng bass clapper", dyn: 0.7 },
      { s: "outro", play: "tag:di gong:gong arp sheng", dyn: 0.56, to: 0.36, rit: 0.85 },
    ],
  ],
  rest: [25, 45],
};
