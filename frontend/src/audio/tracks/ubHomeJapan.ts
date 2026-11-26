// 《缘侧与潮声》：养成篇·家乡的日常——日本（澪的土佐：海边的町，晒着渔网，缘侧上听得见潮声）。旋律原创。
// 家里有一面筝，母亲教着弹；门口走过吹尺八的虚无僧；巷子里的孩子吹篠笛唱拍手歌。
// D 上的阳音阶（D E G A B，民谣的音阶，不用 升F 与 C），4/4（每分钟 84 拍）：
// - 引子：拍子木两响，筝从低处一划而上，尺八一句（音头从下面推上来）；
// - A：筝唱主题，另一面筝在下面按“一拍一组”分解；再一遍尺八接过来（推音、揉音），筝跟着弹同一条旋律（异音）；
// - B：篠笛在高处唱一段孩子的歌（同音反复、跳跳的），缔太鼓很轻地碎着；落在 A 上；
// - A″：全体，太鼓轻轻地“咚 · 咔”；尾声筝扫一个空五度收住。
// 和声不用西洋的大小三和弦：只有空五度的持续音（D–A、G–D、A–E、E–B）——阳音阶的每个音放在这几个空五度上都不刺耳。
// 衬底（合成的持续音与很轻的拨奏）管弦版换成很轻的弦乐。
import type { TrackDef } from "../score";

export const UB_HOME_JAPAN: TrackDef = {
  id: "ub_home_japan",
  title: { zh: "缘侧与潮声" },
  qpm: 84,
  meter: [4, 4],
  key: "D mixolydian",
  voices: {
    koto: { inst: "koto", gain: 0.6, pan: -0.12, reverb: 0.32 },
    kpat: { inst: "koto", gain: 0.26, pan: 0.24, reverb: 0.3, pattern: { kind: "arp", low: 50, steps: "1 5 8 . 12 8 5 .", ring: 2 } },
    shaku: { inst: "shakuhachi", gain: 0.46, pan: 0.06, reverb: 0.42 },
    fue: { inst: "shinobue", gain: 0.36, pan: 0.14, reverb: 0.36 },
    hyo: { inst: "perc", gain: 0.3, pan: -0.06, reverb: 0.34, pattern: { kind: "drum", steps: "H.H.............", hits: { H: ["hyoshigi", 0.6] } } },
    shime: { inst: "perc", gain: 0.22, pan: 0.28, reverb: 0.24, pattern: { kind: "drum", steps: "S.s.S.s.", hits: { S: ["shime", 0.4], s: ["shime", 0.24] } } },
    taiko: { inst: "perc", gain: 0.2, pan: -0.04, reverb: 0.3, pattern: { kind: "drum", steps: "D...k.D.", hits: { D: ["taiko_don", 0.5], k: ["taiko_ka", 0.3] } } },
    // 衬底（合成）：很轻的空五度持续音与拨奏
    dem: { inst: "drone", gain: 0.12, pan: -0.2, reverb: 0.44, pattern: { kind: "pad", low: 50, high: 69, size: 2 } },
    pz: { inst: "pizz", gain: 0.16, pan: 0.06, reverb: 0.16, pattern: { kind: "arp", low: 38, steps: "1 . . . 5 . . .", ring: 3 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "D5 | D5",
      lines: {
        sw: "D,/2A,/2D/2E/2 G/2A/2B/2d/2 e4 | z8",
        shi: "z8 | !bend!A3 G E2 D2",
      },
    },
    A: {
      bars: 8,
      chords: "D5 | D5 | G5 | A5 | D5 | G5 | E5 | D5",
      lines: {
        mel: "A2 B A G2 E2 | D3 E G2 A2 | B2 d B A2 G2 | A6 z2 | d2 e d B2 A2 | B2 A G E2 G2 | E3 G A2 B,2 | D6 z2",
        // 尺八：同一条旋律，推音（!bend!）与揉音（!vib!）
        shk: "!bend!A2 B A G2 !vib!E2 | D3 E G2 !vib!A2 | B2 d B A2 G2 | !vib!A6 z2 | d2 e d B2 !bend!A2 | B2 A G E2 G2 | !bend!E3 G A2 B,2 | !vib!D6 z2",
      },
    },
    B: {
      bars: 8,
      chords: "G5 | G5 | D5 | D5 | E5 | A5 | G5 | A5",
      lines: { bm: "d2 d B d2 e2 | d2 B A B4 | A2 B d e2 d2 | d6 z2 | e2 e d B2 d2 | e2 d B A4 | G2 A B d2 B2 | A6 z2" },
    },
    coda: {
      bars: 2,
      chords: "D5 | D5",
      lines: { cd: "B2 A G E2 G2 | !vib!D8", cdk: "B2 A G E2 G2 | [D,A,D]8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "sw:koto shi:shaku hyo dem", dyn: 0.56 },
      { s: "A", play: "mel:koto kpat dem", dyn: 0.58 },
      { s: "A", play: "shk:shaku mel:koto kpat dem pz", dyn: 0.62 },
      { s: "B", play: "bm:fue kpat shime dem", dyn: 0.6 },
      { s: "A", play: "shk:shaku mel:koto kpat shime taiko dem pz", dyn: 0.66 },
      { s: "coda", play: "cd:shaku cdk:koto dem", dyn: 0.58, to: 0.42, rit: 0.86 },
    ],
    [
      { s: "intro", play: "sw:koto hyo dem", dyn: 0.54 },
      { s: "A", play: "mel:koto kpat dem", dyn: 0.58 },
      { s: "B", play: "bm:koto kpat dem", dyn: 0.58 },
      { s: "A", play: "shk:shaku mel:koto kpat dem pz", dyn: 0.62 },
      { s: "B", play: "bm:fue kpat shime dem pz", dyn: 0.62 },
      { s: "A", play: "shk:shaku mel:koto kpat shime taiko dem pz", dyn: 0.66 },
      { s: "coda", play: "cd:shaku cdk:koto dem", dyn: 0.58, to: 0.42, rit: 0.86 },
    ],
  ],
  rest: [10, 16],
  level: 1.12,
};
