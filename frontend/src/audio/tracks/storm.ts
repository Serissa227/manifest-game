// 《怒涛》：海上的暴风雨。C 小调，6/8 拍（附点四分音符每分钟 84 拍），紧张、翻滚，但不是海战：
// 大提琴组不停地拉一个翻滚的八分音符固定音型（主音 → 二级 → 三级 → 二级 → 主音 → 下方五度，跟着和弦走），像一道道压过来的浪；
// 弦乐群与人声“呜——”是风，定音鼓每四小节滚奏一次、浪头砸下来时重击；军鼓在第三、六拍，低沉的大鼓两小节一下。
// A 段小提琴组在高处拉一条焦急的线（C 小调 → 降 A → F 小调 → G 大三和弦，还原 B 是和声小调的导音）；
// B 段圆号吹出变成小调的起帆动机式号角，小提琴高八度齐奏，经过降 D 大三和弦（那不勒斯和弦）推到属和弦。
// 天气好了就回到原来的航海曲（从离开的那一段接着奏）。
import type { TrackDef } from "../score";

/** 大提琴组的翻滚音型：各和弦一小节。 */
const OST: Readonly<Record<string, string>> = {
  Cm: "C,D,E, D,C,G,,",
  Ab: "A,,B,,C, B,,A,,E,,",
  Fm: "F,,G,,A,, G,,F,,C,",
  G: "G,,=A,,=B,, =A,,G,,D,,",
  Bb: "B,,C,D, C,B,,F,,",
  Eb: "E,,F,,G,, F,,E,,B,,",
  Db: "_D,E,F, E,_D,A,,",
};

const ost = (chords: string): string =>
  chords
    .split("|")
    .map((c) => OST[c.trim()])
    .join(" | ");

export const STORM: TrackDef = {
  id: "storm",
  title: { zh: "怒涛", en: "Raging Seas" },
  qpm: 126,
  meter: [6, 8],
  key: "C minor",
  hall: true,
  voices: {
    celli: { inst: "celli", gain: 0.5, pan: 0.15, reverb: 0.28 },
    violins: { inst: "violins", gain: 0.52, pan: -0.25, reverb: 0.34 },
    horns: { inst: "horns", gain: 0.54, pan: 0.28, reverb: 0.4 },
    strings: { inst: "strings", gain: 0.4, pan: -0.1, reverb: 0.4, pattern: { kind: "pad", low: 50, high: 67, size: 3 } },
    choir: { inst: "choir", gain: 0.3, pan: 0.2, reverb: 0.6, pattern: { kind: "pad", low: 57, high: 74, size: 3 } },
    timp: { inst: "timpani", gain: 0.42, reverb: 0.3 },
    snare: { inst: "perc", gain: 0.36, pan: -0.15, reverb: 0.25, pattern: { kind: "drum", steps: "..s..s", hits: { s: ["snare", 0.34] } } },
    boom: { inst: "perc", gain: 0.2, pan: 0.05, reverb: 0.35, pattern: { kind: "drum", steps: "T.....T..t..", hits: { T: ["taiko", 0.7], t: ["taiko", 0.35] } } },
    cymbal: { inst: "perc", gain: 0.1, pan: 0.3, reverb: 0.4, pattern: { kind: "drum", steps: "C" + ".".repeat(47), hits: { C: ["cymbal", 0.7] } } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "Cm | Cm",
      lines: {
        ost: ost("Cm | Cm"),
        timp: "!trem!C,,6- | C,,6",
      },
    },
    A: {
      bars: 8,
      chords: "Cm | Ab | Fm | G | Cm | Ab | Bb | G",
      lines: {
        ost: ost("Cm | Ab | Fm | G | Cm | Ab | Bb | G"),
        mel: "G3 c3 | e3 c3 | f3 A3 | =B6 | c3 e3 | a3 e3 | f3 d3 | g6",
        timp: "z6 | z6 | z6 | !trem!G,,6 | !accent!C,,2 z4 | z6 | z6 | !trem!G,,6",
      },
    },
    B: {
      bars: 8,
      chords: "Fm | Cm | Ab | Eb | Fm | Cm | Db | G",
      lines: {
        ost: ost("Fm | Cm | Ab | Eb | Fm | Cm | Db | G"),
        // 圆号：变成小调的号角
        hmel: "F3 A3 | G3 E3 | A3 c3 | B6 | c3 A3 | G3 c3 | _d3 A3 | =B6",
        timp: "!accent!F,,2 z4 | C,,2 z4 | z6 | !trem!E,,6 | !accent!F,,2 z4 | C,,2 z4 | z6 | !trem!G,,6",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "ost:celli timp:timp strings", dyn: 0.62, to: 0.72 },
      { s: "A", play: "ost:celli strings timp:timp snare boom", dyn: 0.72 },
      { s: "A", play: "ost:celli mel:violins strings choir timp:timp snare boom", dyn: 0.76 },
      { s: "B", play: "ost:celli hmel:horns hmel:violins+12 strings choir timp:timp snare boom cymbal", dyn: 0.82 },
      { s: "A", play: "ost:celli mel:violins mel:horns-12 strings choir timp:timp snare boom", dyn: 0.8 },
    ],
    [
      { s: "intro", play: "ost:celli timp:timp", dyn: 0.62, to: 0.7 },
      { s: "A", play: "ost:celli mel:violins strings timp:timp snare boom", dyn: 0.74 },
      { s: "B", play: "ost:celli hmel:horns strings choir timp:timp snare boom", dyn: 0.78 },
      { s: "B", play: "ost:celli hmel:horns hmel:violins+12 strings choir timp:timp snare boom cymbal", dyn: 0.82 },
      { s: "A", play: "ost:celli mel:violins mel:horns-12 strings choir timp:timp snare boom", dyn: 0.8 },
    ],
  ],
  rest: [3, 6],
};
