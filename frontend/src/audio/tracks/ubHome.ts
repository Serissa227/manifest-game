// 《晨光里的家》：养成篇的家乡期（1553 年，十二三岁，家人、导师与家乡的海）。F 大调，3/4 拍，每分钟 88 拍，温暖的早晨。
// 开头竖琴的分解和弦像窗外慢慢亮起来的天，钢片琴一串向上的 F 大三和弦是照进屋里的第一道光；
// 竖笛轻轻吹出养成篇的“成长动机”（5 → 1 → 2 → 3：一个孩子往上迈的几步，结业的曲子里会把它走完），
// A 段木笛唱主题（前半句停在属和弦上，后半句爬到高音 F 再一级级落回来，停在三音上，像话还没说完）；
// 再唱一遍时提琴接过来，大提琴在下面拉一条温和的对位，最后落回主音；B 段转到 D 小调一侧，竖笛唱一段带点心事的旋律，又回到家。
// 没有打击乐：这是一天开始的地方，安静、明亮、不催人。养成篇的曲子都用这个动机，听得出是同一段少年时光。
import type { TrackDef } from "../score";

export const UB_HOME: TrackDef = {
  id: "ub_home",
  title: { zh: "晨光里的家", en: "Morning Light at Home" },
  qpm: 88,
  meter: [3, 4],
  key: "F major",
  level: 1.06,
  voices: {
    flute: { inst: "flute", gain: 0.62, pan: -0.12, reverb: 0.32 },
    fiddle: { inst: "fiddle", gain: 0.54, pan: 0.18, reverb: 0.32 },
    recorder: { inst: "recorder", gain: 0.5, pan: 0.08, reverb: 0.32 },
    cello: { inst: "cello", gain: 0.44, pan: 0.24, reverb: 0.28 },
    celesta: { inst: "celesta", gain: 0.36, pan: -0.3, reverb: 0.5 },
    harp: {
      inst: "harp",
      gain: 0.34,
      pan: -0.28,
      reverb: 0.36,
      pattern: {
        a: { kind: "arp", low: 41, steps: "1 5 8 10 12 10", ring: 2 },
        b: { kind: "arp", low: 41, steps: "1 . 8 . 10 .", ring: 3 },
      },
    },
    strings: { inst: "strings", gain: 0.36, pan: 0.2, reverb: 0.4, pattern: { kind: "pad", low: 53, high: 69, size: 3 } },
    bass: { inst: "pizz", gain: 0.36, pan: 0.06, reverb: 0.18, pattern: { kind: "arp", low: 36, steps: "1 . . . 5, .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "F | Bb/F | F | C7sus4",
      lines: {
        // 第一道光：向上的 F 大三和弦
        chime: "z2 c'2 f'2 | f'4 d'2 | z6 | z6",
        // 成长动机
        motif: "z6 | z6 | C F G2 A2 | G4 z2",
      },
    },
    A: {
      bars: 8,
      chords: "F | Bb | F/C | C | F | Dm | Bb C7 | F",
      lines: {
        // 前半句停在属和弦上，后半句爬到高音 F 再落回三音
        mel: "C F G2 A2 | B3 c d2 | c2 A2 F2 | G4 z2 | C F G2 A2 | d3 e f2 | d2 c2 B2 | A4 z2",
        // 再唱一遍：落回主音
        mel2: "C F G2 A2 | B3 c d2 | c2 A2 F2 | G4 z2 | A3 B c2 | f3 e d2 | c2 B2 G2 | F4 z2",
        // 中音区温和的对位
        cnt: "A,4 C2 | D4 F2 | C4 A,2 | B,4 C2 | A,4 C2 | F4 A,2 | D2 C2 E,2 | F,4 z2",
      },
    },
    B: {
      bars: 8,
      chords: "Dm | Am | Bb | F | Gm7 | Dm | Bb | C7",
      lines: {
        bmel: "f4 e2 | e3 d c2 | d3 c B2 | A4 z2 | B3 c d2 | f3 e d2 | d2 B2 G2 | E4 G2",
      },
    },
    outro: {
      bars: 4,
      chords: "F | Bb | C7 | F",
      lines: {
        tag: "c3 A F2 | d3 c B2 | G2 E2 C2 | F6",
        chime: "z6 | z6 | z6 | z2 c'2 f'2",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "chime:celesta motif:recorder harp.b strings", dyn: 0.5, to: 0.58 },
      { s: "A", play: "mel:flute harp bass", dyn: 0.6 },
      { s: "A", play: "mel2:fiddle cnt:cello harp strings bass", dyn: 0.64 },
      { s: "B", play: "bmel:recorder harp.b strings bass", dyn: 0.62 },
      { s: "A", play: "mel2:flute cnt:cello harp strings bass", dyn: 0.64, to: 0.6 },
      { s: "outro", play: "tag:flute chime:celesta harp.b strings", dyn: 0.55, to: 0.38, rit: 0.85 },
    ],
    [
      { s: "intro", play: "motif:flute harp.b", dyn: 0.48, to: 0.56 },
      { s: "A", play: "mel:recorder harp bass", dyn: 0.6 },
      { s: "B", play: "bmel:cello-12 harp.b strings bass", dyn: 0.6 },
      { s: "A", play: "mel2:fiddle cnt:cello harp strings bass", dyn: 0.64, to: 0.6 },
      { s: "outro", play: "tag:fiddle chime:celesta harp.b strings", dyn: 0.54, to: 0.36, rit: 0.85 },
    ],
  ],
  rest: [10, 18],
};
