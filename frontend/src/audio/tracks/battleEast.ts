// 《海上的战鼓》：东亚的海上的海战（明的沿海、东海与黄海、日本的海）——倭寇与海商的船队混着明人与日本人，接舷之前先擂鼓、鸣锣。
// 这几片海上的海战放这一首（与《黑帆》轮着放），别处照旧。第九批 A01（2026-11-11）新写，旋律原创。
// B 羽调式的五声（B D E 升F A），4/4 拍（每分钟 148 拍），戏曲武场“急急风”的打法——板鼓一刻不停，堂鼓与铙钹一下紧过一下，大锣压着句头：
// - 引子：大锣一声，堂鼓、太鼓起；
// - A：唢呐吹主题（同音起句、一级级往上冲），琵琶低八度跟着扫；
// - B：琵琶独自抡一串分解的十六分音符一样的句子（战曲里的“列营”“点将”那种手法），唢呐只在句头吹长音；
// 没有留白，一遍接一遍。不写三和弦，只有空五度；衬底是很轻的弦乐长音（管弦版是中提琴、大提琴与低音提琴）。
import type { TrackDef } from "../score";

const GONG = "G,8 | z8 | G,8 | z8 | G,8 | z8 | G,8 | z8";

export const BATTLE_EAST: TrackDef = {
  id: "battle_east",
  title: { zh: "海上的战鼓" },
  qpm: 148,
  meter: [4, 4],
  key: "B minor",
  level: 1.05,
  voices: {
    suona: { inst: "suona", gain: 0.48, pan: -0.14, reverb: 0.34 },
    pipa: { inst: "pipa", gain: 0.44, pan: 0.24, reverb: 0.26 },
    daluo: { inst: "daluo", gain: 0.34, pan: 0.02, reverb: 0.42 },
    tg: {
      inst: "perc",
      gain: 0.38,
      pan: -0.08,
      reverb: 0.28,
      pattern: {
        a: { kind: "drum", steps: "T..tT.t.", hits: { T: ["tanggu", 0.7], t: ["tanggu", 0.4] } },
        b: { kind: "drum", steps: "T.ttT.ttT.ttTttt", hits: { T: ["tanggu", 0.74], t: ["tanggu", 0.42] } },
      },
    },
    tk: { inst: "perc", gain: 0.3, pan: 0.1, reverb: 0.34, pattern: { kind: "drum", steps: "D...D..d", hits: { D: ["taiko_don", 0.7], d: ["taiko_don", 0.4] } } },
    bo: { inst: "perc", gain: 0.2, pan: 0.24, reverb: 0.32, pattern: { kind: "drum", steps: "..b...b.", hits: { b: ["bo_mute", 0.42] } } },
    bangu: { inst: "perc", gain: 0.2, pan: -0.22, reverb: 0.22, pattern: { kind: "drum", grid: 0.5, steps: "xxxxxxxxxxxxxxxx", hits: { x: ["bangu", 0.3] } } },
    // 衬底（合成）
    pad: { inst: "strings", gain: 0.22, pan: -0.1, reverb: 0.4, pattern: { kind: "pad", low: 54, high: 71, size: 2 } },
    low: { inst: "strings", gain: 0.26, pan: 0.2, reverb: 0.32, pattern: { kind: "pad", low: 35, high: 47, size: 1 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "B5 | B5",
      lines: { gong: "G,8 | z8" },
    },
    A: {
      bars: 8,
      chords: "B5 | B5 | E5 | B5 | D5 | E5 | F#5 | B5",
      lines: {
        mel: "B2 B d e2 f2 | f2 e d B4 | e2 e f a2 b2 | b2 a f e2 d2 | d2 d e f2 a2 | b2 a b a2 f2 | f2 e f a2 f2 | e2 d2 B4",
        gong: GONG,
      },
    },
    B: {
      bars: 8,
      chords: "E5 | E5 | B5 | B5 | A5 | A5 | F#5 | F#5",
      lines: {
        pmel: "E F A B e B A F | E F A B e2 e2 | B, D F B d B F D | B, D F B d2 d2 | A, D E A d A E D | A, D E A e2 e2 | F A B f a f B A | f2 f2 !trem!f4",
        // 唢呐只吹句头的长音
        blow: "e8 | z8 | b8 | z8 | a8 | z8 | f8- | f8",
        gong: GONG,
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "gong:daluo tg.a tk bangu", dyn: 0.7, to: 0.78 },
      { s: "A", play: "mel:suona gong:daluo tg.a tk bo bangu pad low", dyn: 0.78 },
      { s: "A", play: "mel:suona mel:pipa-12 gong:daluo tg.b tk bo bangu pad low", dyn: 0.82 },
      { s: "B", play: "pmel:pipa blow:suona gong:daluo tg.a tk bo bangu pad low", dyn: 0.8 },
      { s: "A", play: "mel:suona mel:pipa-12 gong:daluo tg.b tk bo bangu pad low", dyn: 0.86 },
      { s: "B", play: "pmel:pipa blow:suona gong:daluo tg.b tk bo bangu pad low", dyn: 0.84 },
    ],
    [
      { s: "intro", play: "gong:daluo tg.a tk bangu", dyn: 0.7, to: 0.78 },
      { s: "A", play: "mel:pipa-12 gong:daluo tg.a tk bo bangu low", dyn: 0.76 },
      { s: "B", play: "pmel:pipa gong:daluo tg.a tk bo bangu pad low", dyn: 0.8 },
      { s: "A", play: "mel:suona mel:pipa-12 gong:daluo tg.b tk bo bangu pad low", dyn: 0.84 },
      { s: "B", play: "pmel:pipa blow:suona gong:daluo tg.b tk bo bangu pad low", dyn: 0.84 },
      { s: "A", play: "mel:suona mel:pipa-12 gong:daluo tg.b tk bo bangu pad low", dyn: 0.86 },
    ],
  ],
  rest: [0, 0],
};
