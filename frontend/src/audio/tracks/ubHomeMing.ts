// 《晒书的天井》：养成篇·家乡的日常——明（林晚灯的月港：漳州海澄的商家，梅雨过后把书搬到天井里晒）。旋律原创。
// 闽南人家的午后是南音的声音：洞箫与二弦（这里用二胡）、琵琶横抱着弹、三弦跟着，执拍板的人在每一“板”上拍一下。
// F 宫五声（F G A C D），慢 4/4（每分钟 66 拍），一板一眼：
// - 引子：琵琶一个人从低处弹上来，拍板两下；
// - A：洞箫唱主题（长音上慢慢地揉、句中带倚音），琵琶在每一拍上弹出骨干音（南音里琵琶“点”着骨干，箫与弦在骨干上加花——异音）；
//   再一遍二胡加进来与洞箫同一条旋律，三弦低八度跟着琵琶；
// - B：二胡领一段，落在徵音（C）上；琵琶的骨干换了一套；
// - A″：全体，尾声收在宫音。
// 和声只用五声音阶里的空五度持续音（F–C、C–G、G–D、D–A），不写西洋的大小三和弦。衬底（合成的持续音与很轻的拨奏）管弦版换成很轻的弦乐。
import type { TrackDef } from "../score";

export const UB_HOME_MING: TrackDef = {
  id: "ub_home_ming",
  title: { zh: "晒书的天井" },
  qpm: 66,
  meter: [4, 4],
  key: "F major",
  voices: {
    xiao: { inst: "xiao", gain: 0.5, pan: -0.1, reverb: 0.4 },
    erhu: { inst: "erhu", gain: 0.42, pan: 0.16, reverb: 0.32 },
    pipa: { inst: "pipa", gain: 0.46, pan: 0.24, reverb: 0.3 },
    sanxian: { inst: "sanxian", gain: 0.36, pan: -0.24, reverb: 0.28 },
    ban: {
      inst: "perc",
      gain: 0.22,
      pan: -0.16,
      reverb: 0.3,
      pattern: {
        a: { kind: "drum", steps: "P.......", hits: { P: ["paiban", 0.6] } },
        b: { kind: "drum", steps: "P...p...", hits: { P: ["paiban", 0.6], p: ["paiban", 0.32] } },
      },
    },
    // 衬底（合成）：很轻的空五度持续音与拨奏
    dem: { inst: "drone", gain: 0.12, pan: -0.2, reverb: 0.44, pattern: { kind: "pad", low: 53, high: 69, size: 2 } },
    pz: { inst: "pizz", gain: 0.16, pan: 0.06, reverb: 0.16, pattern: { kind: "arp", low: 36, steps: "1 . . . 5 . . .", ring: 3 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "F5 | F5",
      lines: { pi: "F,2 C2 F2 A2 | c4 C4" },
    },
    A: {
      bars: 8,
      chords: "F5 | F5 | C5 | C5 | D5 | C5 | G5 | F5",
      lines: {
        mel: "c3 d c A G A | F4 {G}A2 G2 | G3 A c2 d c | !vib!c6 z2 | d3 f d c A2 | c2 A G A2 c2 | G3 A G F D2 | !vib!F6 z2",
        // 琵琶的骨干：每拍一个音
        gu: "c2 c2 A2 A2 | F2 F2 A2 G2 | G2 A2 c2 c2 | c2 c2 c2 z2 | d2 d2 c2 A2 | c2 G2 A2 c2 | G2 G2 F2 D2 | F2 F2 F2 z2",
      },
    },
    B: {
      bars: 8,
      chords: "C5 | C5 | G5 | G5 | F5 | D5 | C5 | C5",
      lines: {
        bm: "d3 c A c d2 | !vib!c6 z2 | G2 A c d2 f2 | !vib!d6 z2 | f3 d c d c A | A3 G F2 D2 | C2 D F G2 A2 | !vib!c6 z2",
        bgu: "d2 c2 A2 d2 | c2 c2 c2 z2 | G2 A2 c2 f2 | d2 d2 d2 z2 | f2 d2 c2 A2 | A2 G2 F2 D2 | C2 D2 G2 A2 | c2 c2 c2 z2",
      },
    },
    coda: {
      bars: 2,
      chords: "F5 | F5",
      lines: { cd: "A2 G2 F2 D2 | !vib!F8", cdg: "A2 G2 F2 D2 | F2 F2 F4" },
    },
  },
  forms: [
    [
      { s: "intro", play: "pi:pipa ban.a dem", dyn: 0.56 },
      { s: "A", play: "mel:xiao gu:pipa ban.a dem", dyn: 0.58 },
      { s: "A", play: "mel:xiao mel:erhu gu:pipa gu:sanxian-12 ban.a dem pz", dyn: 0.62 },
      { s: "B", play: "bm:erhu bgu:pipa bgu:sanxian-12 ban.b dem", dyn: 0.6 },
      { s: "A", play: "mel:xiao mel:erhu gu:pipa gu:sanxian-12 ban.a dem pz", dyn: 0.64 },
      { s: "coda", play: "cd:xiao cd:erhu cdg:pipa ban.a dem", dyn: 0.58, to: 0.42, rit: 0.86 },
    ],
    [
      { s: "A", play: "mel:erhu gu:pipa ban.a dem", dyn: 0.58 },
      { s: "B", play: "bm:xiao bgu:pipa bgu:sanxian-12 ban.b dem pz", dyn: 0.6 },
      { s: "A", play: "mel:xiao mel:erhu gu:pipa gu:sanxian-12 ban.a dem pz", dyn: 0.64 },
      { s: "coda", play: "cd:xiao cd:erhu cdg:pipa ban.a dem", dyn: 0.58, to: 0.42, rit: 0.86 },
    ],
  ],
  rest: [10, 16],
  level: 1.12,
};
