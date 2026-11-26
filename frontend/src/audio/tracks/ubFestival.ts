// 《节日的街》：养成篇的节日（灯会、圣约翰前夜的篝火、七夕、开斋节……各地的节日共用这一首）。D 大调，3/4 拍，每分钟 168 拍（一小节一拍的快舞），热闹。
// 写法取文艺复兴的加利亚德舞：长—短—长的跳步，句尾两小节用“赫米奥拉”（两小节的 3/4 听成一小节的 3/2：d—升c—d 三个二分音符）收住，
// 那一下“咯噔”是舞步落地。开头小号在街口吹两声，塔博鼓与铃鼓起来，风笛式的 D–A 持续音嗡嗡地托着；
// A 段提琴领跳，再来时竖笛高八度同奏；B 段是游行：小号吹号角式的旋律、圆号低八度跟着，框鼓加进来；尾声在主和弦上一齐落地。
import type { TrackDef } from "../score";

export const UB_FESTIVAL: TrackDef = {
  id: "ub_festival",
  title: { zh: "节日的街", en: "Festival in the Streets" },
  qpm: 168,
  meter: [3, 4],
  key: "D major",
  level: 0.79,
  voices: {
    fiddle: { inst: "fiddle", gain: 0.6, pan: -0.14, reverb: 0.26 },
    recorder: { inst: "recorder", gain: 0.42, pan: 0.12, reverb: 0.26 },
    trumpet: { inst: "trumpet", gain: 0.5, pan: 0.22, reverb: 0.3 },
    horns: { inst: "horns", gain: 0.4, pan: -0.28, reverb: 0.34 },
    lute: { inst: "lute", gain: 0.28, pan: 0.3, reverb: 0.22, pattern: { kind: "arp", low: 50, steps: "1 5 8 5 10 5", ring: 2 } },
    bass: { inst: "pizz", gain: 0.42, pan: 0.05, reverb: 0.15, pattern: { kind: "arp", low: 36, steps: "1 . . . 5, .", ring: 2 } },
    drone: { inst: "drone", gain: 0.3, pan: -0.2, reverb: 0.3, pattern: { kind: "drone", notes: [50, 57] } },
    strings: { inst: "strings", gain: 0.32, pan: 0.2, reverb: 0.36, pattern: { kind: "pad", low: 55, high: 72, size: 3 } },
    tabor: { inst: "perc", gain: 0.58, pan: -0.06, reverb: 0.2, pattern: { kind: "drum", steps: "X.x.x.", hits: { X: ["tabor", 0.62], x: ["tabor", 0.36] } } },
    riq: { inst: "perc", gain: 0.42, pan: 0.3, reverb: 0.2, pattern: { kind: "drum", steps: "..r.r.", hits: { r: ["riq", 0.34] } } },
    bodhran: { inst: "perc", gain: 0.36, pan: 0.12, reverb: 0.22, pattern: { kind: "drum", steps: "D...D.D.....", hits: { D: ["bodhran", 0.55] } } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "D | D | A | A",
      lines: {
        // 小号在街口吹两声
        call: "A2 A2 d2 | f4 z2 | e2 e2 c2 | A4 z2",
      },
    },
    A: {
      bars: 8,
      // 第 7、8 小节是赫米奥拉：G（两拍）A（两拍）D（两拍）
      chords: "D | D | G | A | D | Bm | G*4 A*2 | A*2 D*4",
      lines: {
        mel: "A2 d3 e | f3 g a2 | b2 a2 g2 | a4 e2 | A2 d3 e | f3 g f e | d4 c2- | c2 d4",
        mel2: "d2 f3 g | a3 b a2 | g2 b2 d'2 | c'4 a2 | a2 f3 d | d2 f2 b2 | b4 a2- | a2 d4",
      },
    },
    B: {
      bars: 8,
      chords: "G | G | D | D | Em | A | D | A7",
      lines: {
        // 游行：号角式的旋律
        bm: "d3 B d2 | g4 d2 | f3 d f2 | a4 f2 | g3 f e2 | e3 d c2 | d2 f2 a2 | g4 e2",
      },
    },
    outro: {
      bars: 4,
      chords: "G | A | D | D",
      lines: {
        tag: "B2 c2 d2 | e4 c2 | d6 | z6",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:trumpet drone tabor riq", dyn: 0.62, to: 0.7 },
      { s: "A", play: "mel:fiddle lute bass drone tabor riq", dyn: 0.7 },
      { s: "A", play: "mel2:fiddle mel2:recorder lute bass drone tabor riq", dyn: 0.72 },
      { s: "B", play: "bm:trumpet bm:horns-12 lute bass strings tabor bodhran", dyn: 0.74 },
      { s: "A", play: "mel:fiddle mel:recorder+12 lute bass drone tabor riq", dyn: 0.74 },
      { s: "A", play: "mel2:fiddle mel2:trumpet-12 lute bass strings tabor riq bodhran", dyn: 0.76 },
      { s: "outro", play: "tag:fiddle tag:trumpet lute bass strings tabor", dyn: 0.74, to: 0.6, rit: 0.9 },
    ],
    [
      { s: "intro", play: "call:trumpet tabor", dyn: 0.6, to: 0.68 },
      { s: "A", play: "mel:recorder lute bass drone tabor riq", dyn: 0.68 },
      { s: "B", play: "bm:fiddle bm:horns-12 lute bass strings tabor riq", dyn: 0.72 },
      { s: "B", play: "bm:trumpet bm:horns-12 lute bass strings tabor bodhran", dyn: 0.75 },
      { s: "A", play: "mel2:fiddle mel2:recorder lute bass drone tabor riq", dyn: 0.74 },
      { s: "outro", play: "tag:fiddle tag:trumpet lute bass strings tabor", dyn: 0.72, to: 0.58, rit: 0.9 },
    ],
  ],
  rest: [6, 12],
};
