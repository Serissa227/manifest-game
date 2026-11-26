// 《黑潮》：日本的海（黑潮流过的土佐与萨摩外海、濑户内海、日本海）——顺着黑潮往东北走，一天能多跑几十里，水色深得发黑。
// 与《潮待之海》在同一片海轮着放：那一首是等潮水的静，这一首是顺流的快。第九批 A01（2026-11-11）新写，旋律原创。
// E 上的民谣音阶（E G A B D，没有半音），4/4 拍（每分钟 112 拍），像渔村里拉网、摇橹的劳动歌，一句一句带着号子的劲：
// - 引子：三味线拨空弦（E – B – E），太鼓由轻到重；
// - A：三味线领奏，拨子的重音、句尾往下落；再来时篠笛在高处吹长音（与旋律隔着四度、五度：日本合奏里的“各走各的”）；
// - B：中心挪到 A 上（A C D E G），尺八吹一段长的句子，是深处的暗流，太鼓退到只敲句头；再来时三味线把同一条旋律弹成碎的节奏（异音）；
// - 最后一遍 A 太鼓与缔太鼓“咚咚咔”地推着。尾声三味线回到空弦。
// 不写三和弦，只有空五度；衬底是很轻的持续音与低处的弦乐（管弦版换成真的弦乐）。
import type { TrackDef } from "../score";

export const SEA_KUROSHIO: TrackDef = {
  id: "sea_kuroshio",
  title: { zh: "黑潮" },
  qpm: 112,
  meter: [4, 4],
  key: "E minor",
  level: 1.29,
  voices: {
    shami: { inst: "shamisen", gain: 0.5, pan: 0.18, reverb: 0.3 },
    fue: { inst: "shinobue", gain: 0.34, pan: -0.24, reverb: 0.4 },
    shaku: { inst: "shakuhachi", gain: 0.54, pan: -0.1, reverb: 0.42 },
    taiko: {
      inst: "perc",
      gain: 0.32,
      pan: 0.04,
      reverb: 0.36,
      pattern: {
        // 重拍 0.7 → 0.55（2026-11-11 统一验证：合成版第一个 A 段第 8 小节的头一下从静处起，判成咔嗒，见 a01-handoff 6.2）
        a: { kind: "drum", steps: "D..dD.k.", hits: { D: ["taiko_don", 0.55], d: ["taiko_don", 0.4], k: ["taiko_ka", 0.46] } },
        b: { kind: "drum", steps: "D.dkD.dkD.dkDdkk", hits: { D: ["taiko_don", 0.74], d: ["taiko_don", 0.42], k: ["taiko_ka", 0.48] } },
        c: { kind: "drum", steps: "D...............", hits: { D: ["taiko_don", 0.62] } },
      },
    },
    shime: { inst: "perc", gain: 0.18, pan: -0.16, reverb: 0.36, pattern: { kind: "drum", grid: 0.5, steps: "s.s.ssS.s.s.ssS.", hits: { S: ["shime", 0.56], s: ["shime", 0.32] } } },
    hyo: { inst: "perc", gain: 0.22, pan: -0.26, reverb: 0.4, pattern: { kind: "drum", steps: "h" + ".".repeat(31), hits: { h: ["hyoshigi", 0.66] } } },
    // 衬底（合成）
    pad: { inst: "drone", gain: 0.16, pan: -0.22, reverb: 0.42, pattern: { kind: "pad", low: 59, high: 76, size: 2 } },
    low: { inst: "strings", gain: 0.24, pan: 0.08, reverb: 0.34, pattern: { kind: "pad", low: 38, high: 50, size: 1 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "E5 | E5 | E5 | E5",
      lines: { open: "E,2 E,2 B,2 E2 | z8 | E,2 E, E, B,2 E2 | E2 G A B4" },
    },
    A: {
      bars: 8,
      chords: "E5 | E5 | G5 | A5 | E5 | D5 | A5*4 B5*4 | E5",
      lines: {
        mel: "E2 G A B2 B A | B2 d B A G E2 | G2 B d e2 d B | A2 B A G2 E2 | e2 d e g2 e d | d2 B A d2 B A | A2 G A B2 d2 | e2 B G E4",
        // 篠笛的长音（记谱低八度，奏的时候 +12）
        fue: "B4 A4 | G4 E4 | d4 B4 | A4 E4 | B4 e4 | d4 A4 | e4 d4 | B8",
      },
    },
    B: {
      bars: 8,
      chords: "A5 | A5 | D5 | E5 | A5 | G5 | D5 | E5",
      lines: {
        bmel: "!bend!A4 c2 d2 | e4 d2 c2 | d4 A2 c2 | !vib!B6 z2 | A2 c2 e4 | g4 e2 d2 | d2 c2 A2 G2 | !vib!B4 !fall!E4",
        // 三味线：同一条旋律弹成碎的节奏
        bsh: "A2 A c c2 d2 | e2 e d d2 c2 | d2 d A A2 c2 | B2 B2 B4 | A2 c2 e2 e2 | g2 g e e2 d2 | d2 c2 A2 G2 | B2 B2 E4",
      },
    },
    outro: {
      bars: 4,
      chords: "A5 | B5 | E5 | E5",
      lines: { tag: "A2 G A B2 d2 | e2 d B A2 G2 | E2 E, B, E4 | z8" },
    },
  },
  forms: [
    [
      // 引子渐强的终点 0.64 → 0.58（同上：第 4 小节三味线从静处起拨）
      { s: "intro", play: "open:shami taiko.c pad", dyn: 0.54, to: 0.58 },
      { s: "A", play: "mel:shami taiko.a low hyo", dyn: 0.66 },
      { s: "A", play: "mel:shami fue:fue+12 taiko.a shime pad low", dyn: 0.68 },
      { s: "B", play: "bmel:shaku taiko.c pad low", dyn: 0.62 },
      { s: "A", play: "mel:shami fue:fue+12 taiko.b shime pad low hyo", dyn: 0.74 },
      { s: "outro", play: "tag:shami taiko.c pad low", dyn: 0.62, to: 0.46, rit: 0.86 },
    ],
    [
      // 第二种曲式：引子终点 0.62 → 0.58；引子里加上持续音 pad（同第一种曲式）——原来引子只有很低的弦乐，
      // 三味线的长音散掉后几乎全静，A 段头一个三味线音（8.63 秒）从静处起拨，判成咔嗒
      { s: "intro", play: "open:shami taiko.c pad low", dyn: 0.54, to: 0.58 },
      { s: "A", play: "mel:shami taiko.a low", dyn: 0.64 },
      { s: "B", play: "bmel:shaku taiko.c pad low", dyn: 0.62 },
      { s: "B", play: "bmel:shaku bsh:shami taiko.a pad low", dyn: 0.66 },
      { s: "A", play: "mel:shami fue:fue+12 taiko.b shime pad low hyo", dyn: 0.74 },
      { s: "outro", play: "tag:shami taiko.c pad low", dyn: 0.62, to: 0.46, rit: 0.86 },
    ],
  ],
  rest: [25, 45],
};
