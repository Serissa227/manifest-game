// 主题曲《船货清单》：开局画面。D 大调，宽广的 4/4 拍，“扬帆起航”。
// 主题动机：一个“附点十六分 + 长音”的弱起（像帆一下子吃满了风），接五度上行的大跳（D → A），第二小节再一个六度（升 F → D）；
// 这个“起帆动机”在各首航海曲与出港的短乐句里都会再出现。
// 开头船钟两响、定音鼓滚奏渐强、竖琴刮奏，圆号吹出动机、小号高五度应答；A 段圆号唱主题（落在属和弦上，像一句问话），
// A2 段小提琴组接过来推到高音 B 再回主音；B 段转到 B 小调一侧，经过 C 大三和弦（混合利底亚的还原 C，航海歌的色彩）
// 与定音鼓滚奏推回全奏的 A2（小号与小提琴齐奏主题、圆号的对位）；尾声回到动机，定音鼓滚奏在属音上，最后一击落在主音。
// 第二遍换一套配器：木笛吹 A 段、圆号低八度唱 B 段、小提琴在上方拉长音。
import type { TrackDef } from "../score";

export const TITLE: TrackDef = {
  id: "title",
  title: { zh: "船货清单", en: "Manifest" },
  qpm: 80,
  meter: [4, 4],
  key: "D major",
  hall: true,
  voices: {
    horns: { inst: "horns", gain: 0.52, pan: -0.22, reverb: 0.34 },
    trumpet: { inst: "trumpet", gain: 0.4, pan: 0.16, reverb: 0.3 },
    violins: { inst: "violins", gain: 0.5, pan: -0.3, reverb: 0.34 },
    flute: { inst: "flute", gain: 0.46, pan: 0.25, reverb: 0.36 },
    celli: {
      inst: "celli",
      gain: 0.4,
      pan: 0.22,
      reverb: 0.28,
      pattern: {
        a: { kind: "arp", low: 38, steps: "b . . . . . . ." },
        b: { kind: "arp", low: 38, steps: "b . . . 5, . . ." },
      },
    },
    strings: { inst: "strings", gain: 0.4, pan: 0.08, reverb: 0.45, pattern: { kind: "pad", low: 50, high: 71, size: 4 } },
    harp: {
      inst: "harp",
      gain: 0.3,
      pan: -0.42,
      reverb: 0.4,
      pattern: {
        a: { kind: "arp", low: 43, steps: "1 5 8 10 12 10 8 5", ring: 2 },
        b: { kind: "arp", low: 43, steps: "1 8 5 10 8 12 10 15", ring: 2 },
        c: { kind: "arp", low: 43, steps: "1 . 8 . 10 . 12 .", ring: 3 },
      },
    },
    timp: { inst: "timpani", gain: 0.46, reverb: 0.3 },
    bell: { inst: "bell", gain: 0.32, pan: 0.42, reverb: 0.55 },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "D | G/D | D | A",
      lines: {
        // 船钟两响
        bell: "d2 z d2 z3 | z8 | z8 | z8",
        // 定音鼓在主音上滚奏渐强，第二小节末一记重音
        timp: "!trem!D,,8- | D,,6 !accent!D,,2 | z8 | z8",
        // 竖琴两个八度的刮奏
        gliss: "z8 | z6 D/8E/8F/8G/8A/8B/8c/8d/8e/8f/8g/8a/8b/8c'/8d'/8e'/8 | z8 | z8",
        // 圆号吹起帆动机，小号高五度应答
        call: "z8 | z8 | A,3/2 D/2 A6 | z8",
        ans: "z8 | z8 | z8 | E3/2 A/2 e4 z2",
      },
    },
    A: {
      bars: 8,
      pickup: 2,
      chords: "D | G | D | A | D | A/C# | Em | A",
      lines: {
        mel: `A,3/2 D/2 | A6 F2 | d6 c B | A4 G2 F2 | E6 A,3/2 D/2 |
              A6 F2 | e6 d c | B3 A G2 B2 | A6`,
      },
    },
    A2: {
      bars: 8,
      pickup: 2,
      chords: "D | G | D/F# | G | D/A | A | G A | D",
      lines: {
        mel: `A,3/2 D/2 | A6 F2 | d6 c B | A2 d2 f2 a2 | b6 a g |
              f4 e2 d2 | e6 c2 | d3 B A2 c2 | d6`,
        // 圆号的对位：中音区的长音
        hcnt: "z2 | D4 F4 | G4 B4 | A8 | B4 d4 | d4 A4 | A8 | G4 E4 | F6",
        timp: "z2 | D,,2 z6 | G,,2 z6 | z8 | G,,2 z6 | A,,2 z6 | A,,2 z6 | z4 !trem!A,,4 | !accent!D,,2 z4",
      },
    },
    B: {
      bars: 8,
      chords: "Bm | G | D | A | G | C | Em | A",
      lines: {
        mel: `f6 e d | B6 A B | A4 F2 A2 | e4 c2 e2 |
              B3 =c d2 g2 | g4 e2 =c2 | d4 B2 e2 | c6 z2`,
        // 圆号的内声部：一条平稳下行的线
        hb: "D8 | B,8 | A,8 | A,8 | B,8 | =C8 | B,8 | ^C6 z2",
        timp: "z8 | z8 | z8 | z8 | z8 | z8 | !trem!A,,8- | A,,6 z2",
      },
    },
    coda: {
      bars: 4,
      chords: "D | G/D | A/D | D",
      lines: {
        tag: "A,3/2 D/2 A6 | B6 A2 | A6 G2 | F8",
        ttag: "z8 | d8 | c8 | d8",
        timp: "D,,2 z6 | z8 | !trem!A,,8 | !accent!D,,2 z6",
        gliss: "z8 | z8 | z8 | z2 D/4F/4A/4d/4f/4a/4d'/4f'/4 z4",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "bell:bell timp:timp call:horns ans:trumpet gliss:harp harp.c strings celli", dyn: 0.5, to: 0.74 },
      { s: "A", play: "mel:horns harp strings celli", dyn: 0.66 },
      { s: "A2", play: "mel:violins hcnt:horns harp strings celli", dyn: 0.72 },
      { s: "B", play: "mel:violins hb:horns timp:timp harp.b strings celli.b", dyn: 0.66, to: 0.86 },
      { s: "A2", play: "mel:trumpet mel:violins hcnt:horns timp:timp harp strings celli", dyn: 0.82 },
      { s: "coda", play: "tag:horns ttag:trumpet timp:timp gliss:harp strings celli", dyn: 0.74, to: 0.5, rit: 0.72 },
    ],
    [
      { s: "intro", play: "bell:bell gliss:harp harp.c strings", dyn: 0.46, to: 0.6 },
      { s: "A", play: "mel:flute+12 harp.c strings celli", dyn: 0.6 },
      { s: "A2", play: "mel:violins hcnt:horns harp strings celli", dyn: 0.68 },
      { s: "B", play: "mel:horns-12 hb:violins+12 timp:timp harp.b strings celli.b", dyn: 0.64, to: 0.84 },
      { s: "A2", play: "mel:trumpet mel:violins hcnt:horns timp:timp harp strings celli", dyn: 0.82 },
      { s: "coda", play: "tag:horns ttag:trumpet timp:timp gliss:harp strings celli", dyn: 0.72, to: 0.48, rit: 0.72 },
    ],
  ],
  rest: [8, 16],
};
