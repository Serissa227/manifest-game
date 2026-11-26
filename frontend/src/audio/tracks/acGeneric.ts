// 《学院的回廊》：学院的短主题·自创主角（十二个模板各配的学院：领航员考试、印刷所的圈子、大学……共用这一首）。
// 降 B 大调，4/4（每分钟 100 拍，一遍半分钟），开头仍是养成篇的成长动机（F → 降B → C → D：5 → 1 → 2 → 3），
// 竖笛唱，竖琴弹分解和弦、拨奏低音一拍一个；B 段提琴接过来，经过 C 小三和弦与 F 回到降 B。不带哪一种文化的颜色，配得上任何一所学院。
import type { TrackDef } from "../score";

export const AC_GENERIC: TrackDef = {
  id: "ac_generic",
  title: { zh: "学院的回廊", en: "Cloister Walk" },
  qpm: 100,
  meter: [4, 4],
  key: "Bb major",
  level: 1.1,
  voices: {
    recorder: { inst: "recorder", gain: 0.56, pan: -0.12, reverb: 0.3 },
    fiddle: { inst: "fiddle", gain: 0.52, pan: 0.16, reverb: 0.3 },
    harp: { inst: "harp", gain: 0.3, pan: -0.28, reverb: 0.34, pattern: { kind: "arp", low: 46, steps: "1 5 8 10 12 10 8 5", ring: 2 } },
    strings: { inst: "strings", gain: 0.3, pan: 0.2, reverb: 0.4, pattern: { kind: "pad", low: 55, high: 70, size: 3 } },
    bass: { inst: "pizz", gain: 0.34, pan: 0.05, reverb: 0.15, pattern: { kind: "arp", low: 34, steps: "1 . 5, . 1 . 5, .", ring: 2 } },
  },
  sections: {
    A: {
      bars: 8,
      chords: "Bb | Eb | Gm | F | Bb | Cm7 | F | Bb",
      // 成长动机 F → 降B → C → D
      lines: { mel: "F B c2 d4 | e3 d c2 B2 | B3 c d2 g2 | f4 c4 | F B c2 d4 | e3 f g2 e2 | d2 c2 A2 c2 | B8" },
    },
    B: {
      bars: 4,
      chords: "Gm | Eb | Cm F | Bb",
      lines: { bmel: "d3 c B2 G2 | G3 A B2 e2 | e2 c2 F2 A2 | B8" },
    },
  },
  forms: [
    [
      { s: "A", play: "mel:recorder harp bass", dyn: 0.62 },
      { s: "B", play: "bmel:fiddle harp strings bass", dyn: 0.64, to: 0.58, rit: 0.92 },
    ],
    [
      { s: "A", play: "mel:fiddle harp strings bass", dyn: 0.62 },
      { s: "B", play: "bmel:recorder harp bass", dyn: 0.62, to: 0.56, rit: 0.92 },
    ],
  ],
  rest: [8, 14],
};
