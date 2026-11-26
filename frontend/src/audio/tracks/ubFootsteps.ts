// 《巷子里的脚步》：养成篇的情境音乐——紧张（情绪 tense 的事件，与《暗涌》轮着放）。有人在后面跟着，或者是自己在跟着别人——
// 不能跑，只能一步一步地走，听着脚步声。旋律原创。
// 第九批 A01（2026-11-11）新写。C 小调，4/4 拍（每分钟 96 拍），轻、紧，一直绷着：
// - 低音弦乐的拨奏一步一步地走（根音 – 五度 – 八度 – 五度），木鱼一样的响木滴答着；
// - A：竖笛（管弦版是单簧管）在低处吹断开的短句（每个音都是踮着脚的），G 大三和弦的还原 B 把句子吊在半空；
// - A′：同样的短句底下，小提琴组在高处拉一条慢慢爬的长线；
// - B：转到 F 小调一侧，圆号吹一段压低了的号角，经过降 D 大三和弦（降二级）推到属和弦；定音鼓轻轻地敲。
// 一遍奏完只歇几秒就再来。管弦版：单簧管、小提琴、圆号、小提琴组的颤弓、大提琴与低音提琴的拨奏、定音鼓、响棒。
import type { TrackDef } from "../score";

const STEPS = ".C .E .G z .c z .G z | .E .D .C z G,4 | .A, .C .E z .A z .E z | .D .=B, .G, z D4 | .C .E .G z .c z .e z | .c .A .F z A4 | .G .=B .d z .f z .d z | =B6 z2";

export const UB_FOOTSTEPS: TrackDef = {
  id: "ub_footsteps",
  title: { zh: "巷子里的脚步" },
  qpm: 96,
  meter: [4, 4],
  key: "C minor",
  level: 1.41,
  voices: {
    // 竖笛的音量压着：断奏的短句是在很安静的地方起音的，吐音的那一下噪声再响就成了“嗒”的一声（试听台量到过）
    cl: { inst: "recorder", gain: 0.34, pan: 0.12, reverb: 0.3 },
    vns: { inst: "violins", gain: 0.4, pan: -0.28, reverb: 0.36 },
    hn: { inst: "horn", gain: 0.44, pan: -0.2, reverb: 0.4 },
    pad: { inst: "strings", gain: 0.14, pan: 0.1, reverb: 0.42, pattern: { kind: "pad", low: 60, high: 77, size: 3 } },
    pz: { inst: "pizz", gain: 0.3, pan: 0.14, reverb: 0.16, pattern: { kind: "arp", low: 36, steps: "1 . 5 . 8 . 5 .", ring: 1 } },
    timp: { inst: "timpani", gain: 0.3, reverb: 0.3 },
    wb: { inst: "perc", gain: 0.2, pan: 0.24, reverb: 0.2, pattern: { kind: "drum", steps: "w...w.w.", hits: { w: ["woodblock", 0.4] } } },
  },
  sections: {
    intro: { bars: 2, chords: "Cm | Cm" },
    A: {
      bars: 8,
      chords: "Cm | Cm | Ab | G | Cm | Fm | G | G",
      lines: {
        mel: STEPS,
        timp: "C,2 z6 | z8 | z8 | G,,2 z2 G,,2 z2 | C,2 z6 | z8 | z8 | !trem!G,,8",
      },
    },
    A2: {
      bars: 8,
      chords: "Cm | Cm | Ab | G | Cm | Fm | G | G",
      lines: {
        mel: STEPS,
        // 高处慢慢爬的长线
        high: "g8 | e4 d4 | e8 | d6 =B2 | g8 | a4 f4 | g4 f4 | d8",
        timp: "C,2 z6 | z8 | z8 | G,,2 z2 G,,2 z2 | C,2 z6 | z8 | z8 | !trem!G,,8",
      },
    },
    B: {
      bars: 8,
      chords: "Fm | Fm | Cm | Cm | Db | Db | G | G",
      lines: {
        bmel: "F4 A3 c | c2 A2 F4 | E4 G3 c | c2 G2 E4 | _D4 F3 A | A2 F2 _D4 | D4 G3 =B | d8",
        timp: "z8 | z8 | C,2 z6 | z8 | z8 | z8 | G,,2 z2 G,,2 z2 | !trem!G,,8",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "pz wb", dyn: 0.56, to: 0.6 },
      { s: "A", play: "mel:cl pz wb timp:timp", dyn: 0.62 },
      { s: "A2", play: "mel:cl high:vns pz wb pad timp:timp", dyn: 0.64 },
      { s: "B", play: "bmel:hn pz wb pad timp:timp", dyn: 0.66, to: 0.7 },
      { s: "A2", play: "mel:cl high:vns pz wb pad timp:timp", dyn: 0.68 },
    ],
    [
      { s: "intro", play: "pz wb", dyn: 0.56, to: 0.6 },
      { s: "A", play: "mel:cl pz wb timp:timp", dyn: 0.62 },
      { s: "B", play: "bmel:hn pz wb pad timp:timp", dyn: 0.64 },
      { s: "A2", play: "mel:cl high:vns pz wb pad timp:timp", dyn: 0.66 },
      { s: "B", play: "bmel:hn bmel:vns+12 pz wb pad timp:timp", dyn: 0.68, to: 0.72 },
      { s: "A2", play: "mel:cl high:vns pz wb pad timp:timp", dyn: 0.68 },
    ],
  ],
  rest: [3, 6],
};
