// 《擂台上的旗》：养成篇的比赛（歌合、蹴鞠、龙舟、辩论、竞渡……各种比赛共用这一首）。C 大调，4/4，每分钟 132 拍，昂扬、年轻。
// 开头小号把成长动机吹成号角（附点的 G → C → D → E，再高八度一遍），定音鼓滚奏；
// A 段小提琴组唱一段向上冲的主题（“嗒——嗒 嗒 嗒”的附点节奏），大提琴组在下面不停地拉八分音符，军鼓轻快地推着；
// 再来时小号领、圆号在中音区吹一条长音的对位；B 段转到 A 小调一侧，咬着牙往上爬，停在属和弦上；最后全奏一遍主题，落在主和弦上。
// 是比赛不是战斗：没有大鼓与钹的轰击，军鼓与定音鼓只是推着往前跑。
import type { TrackDef } from "../score";

export const UB_CONTEST: TrackDef = {
  id: "ub_contest",
  title: { zh: "擂台上的旗", en: "Banners over the Contest" },
  qpm: 132,
  meter: [4, 4],
  key: "C major",
  level: 0.78,
  voices: {
    trumpet: { inst: "trumpet", gain: 0.5, pan: 0.2, reverb: 0.3 },
    violins: { inst: "violins", gain: 0.56, pan: -0.24, reverb: 0.3 },
    horns: { inst: "horns", gain: 0.46, pan: -0.3, reverb: 0.34 },
    recorder: { inst: "recorder", gain: 0.36, pan: 0.04, reverb: 0.28 },
    ost: { inst: "celli", gain: 0.36, pan: 0.18, reverb: 0.22, pattern: { kind: "arp", low: 36, steps: "1 1 5 1 8 1 5 1" } },
    strings: { inst: "strings", gain: 0.34, pan: 0.1, reverb: 0.36, pattern: { kind: "pad", low: 55, high: 72, size: 3 } },
    timp: { inst: "timpani", gain: 0.4, reverb: 0.3 },
    snare: {
      inst: "perc",
      gain: 0.34,
      pan: -0.12,
      reverb: 0.22,
      pattern: {
        a: { kind: "drum", steps: "X.x.X.xx", hits: { X: ["snare", 0.42], x: ["snare", 0.22] } },
        b: { kind: "drum", steps: "X.x.X.x.X.x.Xxxx", hits: { X: ["snare", 0.46], x: ["snare", 0.24] } },
      },
    },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "C | C | F G | C",
      lines: {
        // 成长动机吹成号角
        call: "G,3/2 C/2 D2 E4 | G3/2 c/2 d2 e4 | f2 e2 d2 B2 | c4 z4",
        timp: "!trem!G,,8- | G,,8 | z8 | !accent!C,2 z6",
      },
    },
    A: {
      bars: 8,
      chords: "C | G/B | Am | F | C/G | F | Dm7 G | C",
      lines: {
        mel: "G3 c c2 e2 | d4 B2 G2 | c3 e e2 a2 | a4 g2 f2 | e3 d c2 e2 | f4 a2 f2 | d2 f2 B2 d2 | c4 z4",
        // 圆号在中音区的长音对位
        hcnt: "C4 E4 | D4 G,4 | E4 C4 | F4 C4 | G,4 C4 | A,4 C4 | F4 D4 | E8",
        timp: "C,2 z6 | G,,2 z6 | A,,2 z6 | F,,2 z6 | G,,2 z6 | F,,2 z6 | z4 !trem!G,,4 | C,2 z6",
      },
    },
    B: {
      bars: 8,
      chords: "Am | Em | F | C | Dm | Am | F | G",
      lines: {
        // 咬着牙往上爬，停在属和弦上
        bmel: "e3 e e2 c2 | B4 G4 | A3 c f2 a2 | g6 e2 | f3 f f2 d2 | e4 c4 | d2 f2 a2 c'2 | b4 g4",
        timp: "A,,2 z6 | E,,2 z6 | F,,2 z6 | C,2 z6 | D,,2 z6 | A,,2 z6 | F,,2 z6 | !trem!G,,8",
      },
    },
    outro: {
      bars: 2,
      chords: "F G | C",
      lines: { tag: "f2 e2 d2 B2 | c8", timp: "z4 !trem!G,,4 | !accent!C,2 z6" },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:trumpet timp:timp strings", dyn: 0.66, to: 0.74 },
      { s: "A", play: "mel:violins ost strings snare", dyn: 0.72 },
      { s: "A", play: "mel:trumpet mel:violins hcnt:horns ost strings snare timp:timp", dyn: 0.76 },
      { s: "B", play: "bmel:violins bmel:horns-12 ost strings snare timp:timp", dyn: 0.74, to: 0.8 },
      { s: "A", play: "mel:trumpet mel:violins mel:recorder+12 hcnt:horns ost strings snare.b timp:timp", dyn: 0.82 },
      { s: "outro", play: "tag:trumpet tag:violins strings timp:timp", dyn: 0.82, to: 0.7, rit: 0.8 },
    ],
    [
      { s: "intro", play: "call:trumpet timp:timp", dyn: 0.64, to: 0.72 },
      { s: "A", play: "mel:trumpet ost strings snare", dyn: 0.72 },
      { s: "B", play: "bmel:violins ost strings snare timp:timp", dyn: 0.72, to: 0.78 },
      { s: "B", play: "bmel:trumpet bmel:violins-12 ost strings snare timp:timp", dyn: 0.76, to: 0.8 },
      { s: "A", play: "mel:trumpet mel:violins mel:recorder+12 hcnt:horns ost strings snare.b timp:timp", dyn: 0.82 },
      { s: "outro", play: "tag:trumpet tag:violins strings timp:timp", dyn: 0.82, to: 0.7, rit: 0.8 },
    ],
  ],
  rest: [4, 8],
};
