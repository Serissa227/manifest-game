// 《银枝与白花》：彼界——亚特兰蒂斯深处、精灵的七岛（“比太阳还美”的人、终日的雾、开着白花的银枝；TERRA16 §8.6）。
// E 利底亚（升 A：大调上再“亮”一点、往上飘），慢 3/4（每分钟 60 拍），轻、高、几乎没有低音：
// 钢片琴在高处唱一条简单的旋律（像银枝上的花一朵朵亮起来），竖琴在高音区一上一下地拨（泛音一样的光），弦乐很高很轻地铺着，人声在雾后面“哦”；
// 和声在 E 大七与“E 上的升 F 大三和弦”（利底亚的二级）之间摇，B 段小提琴组唱到最高处（升 F），落回 E 大七。
// 与黑暗之海（八音音阶的雾）完全不同：这里的雾是亮的。
import type { TrackDef } from "../score";

export const REALM_ELVES: TrackDef = {
  id: "realm_elves",
  title: { zh: "银枝与白花", en: "Silver Boughs in Blossom" },
  qpm: 60,
  meter: [3, 4],
  key: "E lydian",
  level: 1.3,
  hall: true,
  space: 1.35,
  voices: {
    celesta: { inst: "celesta", gain: 0.6, pan: -0.12, reverb: 0.6 },
    flute: { inst: "flute", gain: 0.44, pan: 0.16, reverb: 0.55 },
    violins: { inst: "violins", gain: 0.42, pan: -0.24, reverb: 0.6 },
    hp: { inst: "harp", gain: 0.36, pan: -0.3, reverb: 0.55 },
    harp: { inst: "harp", gain: 0.3, pan: -0.36, reverb: 0.55, pattern: { kind: "arp", low: 64, steps: "1 5 8 10 12 10", ring: 3 } },
    air: { inst: "strings", gain: 0.26, pan: 0.2, reverb: 0.66, pattern: { kind: "pad", low: 71, high: 88, size: 3 } },
    choir: { inst: "choir", gain: 0.22, pan: 0.12, reverb: 0.72, pattern: { kind: "pad", low: 64, high: 79, size: 3 } },
    low: { inst: "strings", gain: 0.2, pan: 0.04, reverb: 0.5, pattern: { kind: "pad", low: 52, high: 64, size: 1 } },
  },
  sections: {
    intro: { bars: 2, chords: "Emaj7 | F#/E", lines: { gliss: "E/2G/2B/2d/2e/2g/2b/2d'/2 z2 | z6" } },
    A: {
      bars: 8,
      chords: "Emaj7 | F#/E | Emaj7 | F#/E | C#m7 | G#m7 | F# | B",
      lines: { mel: "b4 g2 | a4 f2 | g4 d2 | c6 | e4 g2 | d4 b2 | c4 a2 | b6" },
    },
    B: {
      bars: 8,
      chords: "G#m7 | C#m7 | F#/E | Emaj7 | C#m7 | F# | B | Emaj7",
      lines: { bmel: "d'4 c'2 | b6 | a4 c'2 | b4 g2 | e'4 d'2 | c'6 | d'4 f'2 | e'6" },
    },
    outro: { bars: 2, chords: "Emaj7 | Emaj7", lines: { tag: "g4 b2 | e'6" } },
  },
  forms: [
    [
      { s: "intro", play: "gliss:hp air", dyn: 0.48, to: 0.54 },
      { s: "A", play: "mel:celesta harp air low", dyn: 0.56 },
      { s: "B", play: "bmel:violins harp air choir low", dyn: 0.58, to: 0.62 },
      { s: "A", play: "mel:celesta mel:flute harp air choir low", dyn: 0.6 },
      { s: "outro", play: "tag:celesta harp air", dyn: 0.5, to: 0.34, rit: 0.85 },
    ],
    [
      { s: "intro", play: "gliss:hp air", dyn: 0.46, to: 0.52 },
      { s: "A", play: "mel:flute harp air low", dyn: 0.54 },
      { s: "B", play: "bmel:violins bmel:celesta-12 harp air choir low", dyn: 0.58, to: 0.62 },
      { s: "outro", play: "tag:celesta harp air", dyn: 0.48, to: 0.32, rit: 0.85 },
    ],
  ],
  rest: [20, 40],
};
