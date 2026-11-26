// 《课业与钟声》：养成篇的学院期（1554—1556 年，课业、同学与先生）。G 大调，4/4 拍，每分钟 120 拍，轻快、有条理。
// 开头学院的钟敲四下（d B c A，落在 G 上）；A 段竖笛吹一段跳跳的主题（开头也是成长动机 D G A B），八分音符多用断奏，
// 像抱着书在回廊里小跑；羽管键琴“下 · 上 ·”地扫，低音拨奏一拍一个；再来一遍时大提琴在下面走一条四分音符的低音线（像先生在讲台上踱步）。
// B 段转到 E 小调一侧，一问一答：低处的大提琴提问两小节，高处的木笛答两小节——课堂上的问答。
// 律动轻、不吵：木块只在主题重来时轻轻点在第二、四拍。
import type { TrackDef } from "../score";

export const UB_ACADEMY: TrackDef = {
  id: "ub_academy",
  title: { zh: "课业与钟声", en: "Lessons and Bells" },
  qpm: 120,
  meter: [4, 4],
  key: "G major",
  level: 1.04,
  voices: {
    recorder: { inst: "recorder", gain: 0.58, pan: -0.12, reverb: 0.26 },
    flute: { inst: "flute", gain: 0.56, pan: 0.16, reverb: 0.28 },
    cello: { inst: "cello", gain: 0.46, pan: 0.22, reverb: 0.22 },
    bell: { inst: "bell", gain: 0.42, pan: 0.32, reverb: 0.6 },
    harpsi: { inst: "harpsichord", gain: 0.2, pan: -0.28, reverb: 0.22, pattern: { kind: "strum", low: 48, high: 72, steps: "D . d . D . d .", spread: 0.02 } },
    bass: { inst: "pizz", gain: 0.38, pan: 0.06, reverb: 0.16, pattern: { kind: "arp", low: 36, steps: "1 . 5, . 1 . 5, .", ring: 2 } },
    strings: { inst: "strings", gain: 0.34, pan: 0.2, reverb: 0.4, pattern: { kind: "pad", low: 52, high: 69, size: 3 } },
    tick: { inst: "perc", gain: 0.22, pan: -0.1, reverb: 0.2, pattern: { kind: "drum", steps: "..w...w.", hits: { w: ["woodblock", 0.3] } } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "G | Am7 D7",
      lines: {
        // 学院的钟
        bell: "d2 B2 c2 A2 | G4 z4",
      },
    },
    A: {
      bars: 8,
      chords: "G | D/F# | Em | C | G | Am7 D7 | G Em | Am7 D",
      lines: {
        mel: `.D .G .A .B d2 B2 | c B A G F2 A2 | G2 B2 e2 d2 | c2 e2 .d .c .B .A |
              .D .G .A .B d2 B2 | c2 e2 d2 F2 | G2 B d e2 B2 | c2 A2 D4`,
        // 低音区四分音符的走句
        walk: "G,2 B,2 D2 B,2 | F,2 A,2 D2 A,2 | E,2 G,2 B,2 G,2 | C,2 E,2 G,2 E,2 | G,2 D2 B,2 G,2 | A,2 C2 D2 F,2 | G,2 B,2 E,2 G,2 | A,2 C2 D,4",
      },
    },
    B: {
      bars: 8,
      chords: "Em | Bm | C | G | Am | Em | C D | G",
      lines: {
        // 提问（低八度奏）与回答
        q: "E2 G B e2 d2 | B2 A G F4 | z8 | z8 | A2 c e a2 g2 | e2 d c B4 | z8 | z8",
        a: "z8 | z8 | g2 e c d2 e2 | d2 B G A4 | z8 | z8 | c2 e g f2 d2 | B4 G4",
      },
    },
    outro: {
      bars: 2,
      chords: "C D7 | G",
      lines: {
        tag: "e2 d c B2 A2 | G2 D2 G4",
        bell: "z8 | z4 G4",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "bell:bell bass", dyn: 0.6 },
      { s: "A", play: "mel:recorder harpsi bass", dyn: 0.62 },
      { s: "A", play: "mel:recorder walk:cello harpsi bass tick", dyn: 0.66 },
      { s: "B", play: "q:cello-12 a:flute strings bass", dyn: 0.62 },
      { s: "A", play: "mel:flute walk:cello harpsi bass tick", dyn: 0.66 },
      { s: "outro", play: "tag:recorder bell:bell harpsi bass", dyn: 0.62, to: 0.5, rit: 0.85 },
    ],
    [
      { s: "intro", play: "bell:bell", dyn: 0.58 },
      { s: "A", play: "mel:flute harpsi bass", dyn: 0.62 },
      { s: "B", play: "q:cello-12 a:recorder strings bass", dyn: 0.62 },
      { s: "B", play: "q:cello-12 a:flute strings harpsi bass", dyn: 0.64 },
      { s: "A", play: "mel:recorder walk:cello harpsi bass tick", dyn: 0.66 },
      { s: "outro", play: "tag:flute bell:bell harpsi bass", dyn: 0.62, to: 0.5, rit: 0.85 },
    ],
  ],
  rest: [8, 14],
};
