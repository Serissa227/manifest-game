// 《潮待之海》：日本的内海与南海路（濑户内海的岛与急流、堺与博多、土佐的海；“潮待ち”——在港里等潮水转向再开船）。
// 地方特色第二阶段重编（东亚宫廷）：地方乐器领奏，旋律与段落照旧（复古合成版的衬底用合成的持续音与弦乐群）。
// D 上的五声，4/4 拍（每分钟 76 拍），慢、留白多（日本音乐讲究的“间”）：
// - A 段阳音阶（民谣的 D E G A B）：尺八唱一段像渔歌的旋律（meri 从下面上来、yuri 揉开、句尾往下落），筝弹分解（根音、五度、八度），
//   太鼓偶尔一下，拍子木在句首敲一声；最后一遍三味线跟着尺八弹同一条旋律（民谣的异音），太鼓“咚 · 咔”；
// - B 段阴音阶（都节：D 降E G A 降B），夜里涨潮、村上水军的船影：换成能乐的囃子——能管一声“ヒシギ”的尖啸，
//   小鼓“噗——”与大鼓“咔！”一低一高地应答，缔太鼓碎着，中间留很长的间；尺八压低了唱；
// - 之后又回到阳音阶，天亮了，潮转了，开船。开头筝一串阳音阶的刮奏，尺八在低处吹起全作的起帆动机（A → D → A）。
// 和声不写西洋的三和弦：只有空五度（D–A、E–B、G–D、降E–降B），筝的分解与衬底都只用根音与五度。
import type { TrackDef } from "../score";

export const SEA_JAPAN: TrackDef = {
  id: "sea_japan",
  title: { zh: "潮待之海", en: "Waiting for the Tide" },
  qpm: 76,
  meter: [4, 4],
  key: "D dorian",
  level: 1.33,
  space: 1.1,
  voices: {
    shaku: { inst: "shakuhachi", gain: 0.56, pan: -0.12, reverb: 0.42 },
    koto: { inst: "koto", gain: 0.44, pan: 0.2, reverb: 0.38 },
    arp: { inst: "koto", gain: 0.22, pan: 0.32, reverb: 0.4, pattern: { kind: "arp", low: 50, steps: "1 5 8 . 12 8 5 .", ring: 3 } },
    shami: { inst: "shamisen", gain: 0.34, pan: 0.26, reverb: 0.3 },
    nohkan: { inst: "nohkan", gain: 0.3, pan: -0.3, reverb: 0.5 },
    taiko: {
      inst: "perc",
      gain: 0.28,
      pan: 0.04,
      reverb: 0.4,
      pattern: {
        a: { kind: "drum", steps: "D.....d.", hits: { D: ["taiko_don", 0.7], d: ["taiko_don", 0.38] } },
        c: { kind: "drum", steps: "D.....d.D...k.k.", hits: { D: ["taiko_don", 0.72], d: ["taiko_don", 0.4], k: ["taiko_ka", 0.5] } },
      },
    },
    hyo: { inst: "perc", gain: 0.24, pan: -0.24, reverb: 0.4, pattern: { kind: "drum", steps: "h" + ".".repeat(15), hits: { h: ["hyoshigi", 0.7] } } },
    // 能乐的囃子：小鼓与大鼓一低一高地应答（中间留很长的间），缔太鼓碎着
    noh: {
      inst: "perc",
      gain: 0.3,
      pan: 0.16,
      reverb: 0.46,
      pattern: { kind: "drum", steps: "P.......K.......P...k...K.......", hits: { P: ["tsuzumi_pon", 0.8], K: ["otsuzumi", 0.85], k: ["otsuzumi_lt", 0.6] } },
    },
    shime: { inst: "perc", gain: 0.16, pan: -0.16, reverb: 0.4, pattern: { kind: "drum", grid: 0.5, steps: "....S.s.....S.ss", hits: { S: ["shime", 0.6], s: ["shime", 0.36] } } },
    // 衬底（合成）：空五度的持续音、低处的弦乐群
    pad: { inst: "drone", gain: 0.18, pan: -0.24, reverb: 0.44, pattern: { kind: "pad", low: 62, high: 79, size: 2 } },
    low: { inst: "strings", gain: 0.26, pan: 0.06, reverb: 0.34, pattern: { kind: "pad", low: 38, high: 50, size: 1 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "D5 | D5",
      lines: {
        // 筝的阳音阶刮奏
        gliss: "D/4E/4G/4A/4B/4d/4e/4g/4 z6 | z8",
        motif: "z6 !bend!A,3/2 D/2 | !vib!A6 z2",
      },
    },
    A: {
      bars: 8,
      chords: "D5 | E5 | G5 | A5 | D5 | E5 | A5 | D5",
      lines: {
        // 阳音阶：像一段渔歌，句尾 E → D 落到主音
        mel: "D2 E2 G4 | G3 A B4 | A4 G2 E2 | !slide!E6 z2 | A2 B2 {e}d4 | e3 d B4 | A3 B A2 G2 | E2 D6",
        // 尺八：同一条旋律，meri 从下面上来、yuri 揉开、句尾落下
        shaku: "!bend!D2 E2 G4 | G3 A !vib!B4 | A4 G2 E2 | !fall!E6 z2 | A2 B2 {e}!bend!d4 | e3 d !vib!B4 | A3 B A2 G2 | E2 !vib!D6",
        // 筝的变奏：倚音多一点
        mel2: "D2 E2 {A}G4 | G3 A {d}B4 | A4 G2 E2 | E6 z2 | A2 B2 {e}d4 | {g}e3 d B4 | A3 B A2 G2 | E2 D6",
        // 三味线：同一条旋律弹成民谣的节奏（异音）
        shami: "D E D E G2 G2 | G2 G A B2 B2 | A2 A G G2 E2 | E2 E2 E4 | A2 B2 d2 d2 | e2 e d B2 B2 | A2 A B A2 G2 | E2 D2 D4",
      },
    },
    B: {
      bars: 8,
      // 阴音阶（都节）：降 E 与降 B；空五度
      chords: "G5 | Eb5 | G5 | D5 | Eb5 | G5 | Eb5 | D5",
      lines: {
        bmel: "d4 _e2 d2 | _B4 G2 _E2 | G3 A _B4 | !slide!A6 z2 | G4 _B2 d2 | d3 _e d4 | _e4 d2 _B2 | A4 D4",
        sbmel: "!bend!d4 _e2 d2 | !vib!_B4 G2 _E2 | G3 A !bend!_B4 | !vib!A6 z2 | G4 _B2 d2 | !bend!d3 _e d4 | _e4 d2 _B2 | !fall!A4 D4",
        // 能管：开头一声ヒシギ，后半一句短的唱歌
        noh: "z2 !bend!a'4 !fall!g'2 | z8 | z8 | z8 | !bend!g4 a2 _b2 | !vib!a4 z4 | z8 | z8",
      },
    },
    outro: {
      bars: 2,
      chords: "G5 | D5",
      lines: { tag: "B4 A2 G2 | !vib!A8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "gliss:koto motif:shaku pad hyo", dyn: 0.52, to: 0.6 },
      { s: "A", play: "shaku:shaku arp low taiko hyo", dyn: 0.62 },
      { s: "B", play: "sbmel:shaku noh:nohkan arp pad low noh shime", dyn: 0.62, to: 0.68 },
      { s: "A", play: "shaku:shaku mel2:koto shami:shami arp pad low taiko.c hyo", dyn: 0.66 },
      { s: "outro", play: "tag:shaku pad low", dyn: 0.54, to: 0.36, rit: 0.85 },
    ],
    [
      { s: "intro", play: "gliss:koto pad", dyn: 0.5, to: 0.58 },
      { s: "A", play: "mel2:koto arp low hyo", dyn: 0.6 },
      { s: "A", play: "shaku:shaku arp pad low taiko hyo", dyn: 0.62 },
      { s: "B", play: "bmel:koto sbmel:shaku-12 noh:nohkan arp pad low noh shime", dyn: 0.62, to: 0.68 },
      { s: "A", play: "shaku:shaku mel2:koto shami:shami arp pad low taiko.c hyo", dyn: 0.66 },
      { s: "outro", play: "tag:shaku pad low", dyn: 0.52, to: 0.34, rit: 0.85 },
    ],
  ],
  rest: [25, 45],
};
