// 《柯克船的号子》：北海与波罗的海（汉萨同盟的吕贝克、但泽、卑尔根，佛兰德斯的港口，挪威的峡湾外海）。
// A 多利亚（升 F：多利亚的六级，D 大三和弦是它的颜色），4/4 拍（每分钟 80 拍），冷、硬、低：是绞盘号子——
// 主歌由一个人领唱（领号的老水手），副歌全船一起吼；一、三拍脚踩在甲板上（跺脚声），开头低沉的船钟一响，起帆动机（E → A → E）。
// 与经典世界的《北风与白鲸》（D 多利亚 6/8、提琴领奏、卡恩特勒琴）不同：这里是 4/4 的号子。
// 地方特色第二阶段（北欧）重编：地方乐器领奏，旋律、和声与段落不变——
// - 起帆动机由山羊角号在远处吹（高八度）；
// - 主歌：尼克尔哈帕（瑞典的键提琴）领号；第二遍克鲁姆管（德意志与低地的“弯角”）在低八度跟着，像第二个老水手；
// - 副歌：风笛（倚音切开重复的音）与尼克尔哈帕一起吼，风笛的持续音管守着 A，雇佣兵的长鼓在甲板上敲；
// 复古合成版的衬底（大提琴组的低声部、人声与弦乐群的长音、拨奏的低音、船钟）照旧，只是退到后面。
import type { TrackDef } from "../score";

export const SEA_HANSA: TrackDef = {
  id: "sea_hansa",
  title: { zh: "柯克船的号子", en: "Shanty of the Cogs" },
  qpm: 80,
  meter: [4, 4],
  key: "A dorian",
  level: 1.23,
  hall: true,
  voices: {
    // 地方乐器（两套编配共用）
    nyck: { inst: "nyckelharpa", gain: 0.52, pan: -0.16, reverb: 0.32 },
    crum: { inst: "crumhorn", gain: 0.42, pan: 0.2, reverb: 0.3 },
    pipe: { inst: "bagpipe", gain: 0.42, pan: -0.04, reverb: 0.32 },
    drones: { inst: "pipe_drone", gain: 0.34, pan: -0.04, reverb: 0.3, pattern: { kind: "drone", notes: [45, 57] } },
    horn: { inst: "bukkehorn", gain: 0.42, pan: 0.3, reverb: 0.55 },
    stomp: { inst: "perc", gain: 0.44, pan: 0.04, reverb: 0.3, pattern: { kind: "drum", steps: "X...X...", hits: { X: ["stomp", 0.55] } } },
    trom: { inst: "perc", gain: 0.24, pan: 0.12, reverb: 0.34, pattern: { kind: "drum", steps: "T...T.r.T...T.rr", hits: { T: ["trommel", 0.7], r: ["trommel_rim", 0.4] } } },
    // 衬底（合成）
    low: { inst: "celli", gain: 0.2, pan: 0.28, reverb: 0.3 },
    choir: { inst: "choir", gain: 0.14, pan: 0.1, reverb: 0.5, pattern: { kind: "pad", low: 52, high: 69, size: 3 } },
    strings: { inst: "strings", gain: 0.17, pan: -0.14, reverb: 0.42, pattern: { kind: "pad", low: 55, high: 72, size: 3 } },
    bass: { inst: "pizz", gain: 0.18, pan: 0.06, reverb: 0.18, pattern: { kind: "arp", low: 36, steps: "1 . . . 5, . . .", ring: 3 } },
    bell: { inst: "bell", gain: 0.28, pan: 0.3, reverb: 0.7 },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "Am | Am | Am | Em",
      lines: {
        bell: "A,8 | z8 | z8 | z8",
        // 起帆动机（E → A → E）
        motif: "z8 | z6 E,3/2 A,/2 | E8 | z8",
      },
    },
    verse: {
      bars: 8,
      chords: "Am | G | Am | Em | Am | G | D | Em",
      lines: {
        // 领号：老水手一个人唱
        lead: "E2 A2 A3 B | B2 A2 G4 | A2 c2 e3 d | B6 z2 | e2 e2 d2 c2 | d3 c B4 | A2 F2 D4 | E6 z2",
      },
    },
    refrain: {
      bars: 8,
      chords: "Am | G | D | Am | C | G | D Em | Am",
      lines: {
        // 全船一起吼
        ref: "A3 A A2 c2 | B3 A G2 B2 | A3 F D2 F2 | E6 z2 | G3 G G2 c2 | d3 c B2 G2 | A2 F2 G2 B2 | A8",
        // 风笛的副歌：同一条旋律，重复的音用倚音切开，一口气不停
        refp: "A3 {g}A {g}A2 c2 | B3 A G2 B2 | A3 F D2 F2 | E8 | G3 {a}G {a}G2 c2 | d3 c B2 G2 | A2 F2 G2 B2 | A8",
        // 低处的齐声
        low: "A,,4 E,4 | G,,4 D,4 | D,4 A,,4 | A,,4 E,4 | C,4 G,4 | G,,4 D,4 | D,4 E,4 | A,,8",
      },
    },
    outro: {
      bars: 2,
      chords: "Em | Am",
      lines: { tag: "B4 G4 | A8", bell: "z8 | A,8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "bell:bell motif:horn+12 strings", dyn: 0.54, to: 0.62 },
      { s: "verse", play: "lead:nyck bass stomp", dyn: 0.64 },
      { s: "refrain", play: "refp:pipe ref:nyck drones low:low choir strings bass stomp trom", dyn: 0.72 },
      { s: "verse", play: "lead:nyck lead:crum-12 drones strings bass stomp", dyn: 0.66 },
      { s: "refrain", play: "refp:pipe ref:nyck ref:crum-12 drones low:low choir strings bass stomp trom", dyn: 0.76 },
      { s: "outro", play: "tag:nyck bell:bell drones strings", dyn: 0.6, to: 0.4, rit: 0.82 },
    ],
    [
      { s: "intro", play: "bell:bell motif:horn+12", dyn: 0.52, to: 0.6 },
      { s: "verse", play: "lead:crum bass stomp", dyn: 0.62 },
      { s: "refrain", play: "ref:nyck low:low strings bass stomp", dyn: 0.7 },
      { s: "verse", play: "lead:nyck strings bass stomp", dyn: 0.66 },
      { s: "refrain", play: "refp:pipe ref:nyck ref:crum-12 drones low:low choir strings bass stomp trom", dyn: 0.76 },
      { s: "outro", play: "tag:nyck bell:bell strings", dyn: 0.58, to: 0.38, rit: 0.82 },
    ],
  ],
  rest: [25, 45],
};
