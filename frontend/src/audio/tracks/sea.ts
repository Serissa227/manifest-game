// 《维斯塔海的风》：在旧世界的内海（地中海式的维斯塔海）上航行。G 混合利底亚调式，6/8 拍的水手号子：
// 船身随浪起伏的律动——低音拨奏落在第一、四拍，吉他“下 · 上 下 · 上”地扫，框鼓“咚 · · 咚 · 嗒”、塔博鼓在第三、六拍推一下。
// 开头圆号远远吹出主题曲的起帆动机（D → G → D）；主歌是领唱与水手的一问一答：簧片（手风琴式）领两小节，提琴答两小节；
// 副歌大家一起唱（簧片与提琴同度齐唱，圆号在下面按和弦音唱十度与八度）；中段转到 E 小调一侧，提琴拉一条长线，像大浪一道道涌过来。
// 这是玩家听得最多的一首，句与句之间留出呼吸，一遍奏完后停一会儿只剩海浪。
import type { TrackDef } from "../score";

export const SEA: TrackDef = {
  id: "sea",
  title: { zh: "维斯塔海的风", en: "Winds of the Vesta Sea" },
  qpm: 96,
  meter: [6, 8],
  key: "G mixolydian",
  voices: {
    reed: { inst: "reed", gain: 0.64, pan: -0.14, reverb: 0.28 },
    fiddle: { inst: "fiddle", gain: 0.58, pan: 0.2, reverb: 0.3 },
    horns: { inst: "horns", gain: 0.46, pan: -0.3, reverb: 0.36 },
    guitar: {
      inst: "guitar",
      gain: 0.13,
      pan: 0.3,
      reverb: 0.22,
      pattern: {
        a: { kind: "strum", low: 40, high: 64, steps: "D . u D . u" },
        c: { kind: "strum", low: 40, high: 64, steps: "D . . d . ." },
      },
    },
    pizz: { inst: "pizz", gain: 0.3, pan: 0.05, reverb: 0.18, pattern: { kind: "arp", low: 36, steps: "1 . . 5, . .", ring: 2 } },
    strings: { inst: "strings", gain: 0.5, pan: -0.22, reverb: 0.42, pattern: { kind: "pad", low: 55, high: 72, size: 3 } },
    drum: {
      inst: "perc",
      gain: 0.4,
      pan: 0.1,
      reverb: 0.22,
      pattern: {
        a: { kind: "drum", steps: "D..T.t", hits: { D: ["bodhran", 0.6], T: ["bodhran", 0.4], t: ["tip", 0.3] } },
        b: { kind: "drum", steps: "D.tD.t D.tDtt", hits: { D: ["bodhran", 0.62], t: ["tip", 0.32] } },
      },
    },
    tabor: { inst: "perc", gain: 0.7, pan: -0.18, reverb: 0.22, pattern: { kind: "drum", steps: "..x..x", hits: { x: ["tabor", 0.45] } } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "G | F | G | G",
      // 起帆动机（主题曲开头的“弱起 + 五度大跳”），圆号在低处远远地吹
      lines: { motif: "z6 | z4 D,3/2 G,/2 | D6 | z6" },
    },
    verse: {
      bars: 8,
      chords: "G | G | F | C | G | G | F | G",
      lines: {
        // 领唱两小节，水手答两小节
        lead: "D2 G G2 A | B2 A G2 D | z6 | z6 | D2 G G2 A | B2 d d2 B | z6 | z6",
        crew: "z6 | z6 | C2 F F2 G | A3 G3 | z6 | z6 | c2 A F2 A | G6",
        // 再唱一遍时领唱加了倚音与回旋音
        lead2: "D2 G G2 A | ~B3 G2 D | z6 | z6 | D2 G G2 A | B2 d {e}d2 B | z6 | z6",
      },
    },
    chorus: {
      bars: 8,
      chords: "C | G | F | G | C | G | F | G",
      lines: {
        mel: `e3 e2 d | d2 B G3 | c3 c2 A | B3 d3 |
              e3 g2 e | d2 B G2 B | A2 c F2 A | G6`,
        // 水手们在下面唱的和声（按和弦音走，多是十度与八度）
        low: "C3 E2 D | D2 D B,3 | A,3 A,2 F, | G,3 B,3 | C3 E2 C | B,2 D B,2 D | C2 A, F,2 C | B,6",
      },
    },
    bridge: {
      bars: 8,
      chords: "Em | Am | Em | C | Am | Dm | F | G",
      lines: {
        mel: `g3 f e2 | e3 d c2 | B3 A G2 | G3 E3 |
              A3 B c2 | d3 e f2 | a3 g f2 | g3 d3`,
      },
    },
    outro: { bars: 4, chords: "G | F | C | G", lines: { tag: "d3 B2 G | c3 A2 F | E3 G2 c | G6" } },
  },
  forms: [
    [
      { s: "intro", play: "motif:horns guitar pizz drum", dyn: 0.55, to: 0.64 },
      { s: "verse", play: "lead:reed crew:fiddle guitar pizz drum", dyn: 0.68 },
      { s: "chorus", play: "mel:reed mel:fiddle guitar pizz drum tabor strings", dyn: 0.72 },
      { s: "bridge", play: "mel:fiddle strings guitar.c pizz drum", dyn: 0.68, to: 0.74 },
      { s: "verse", play: "lead2:reed crew:fiddle crew:horns-12 guitar pizz drum tabor", dyn: 0.72 },
      { s: "chorus", play: "mel:reed mel:fiddle low:horns guitar pizz drum.b tabor strings", dyn: 0.74 },
      { s: "outro", play: "tag:reed guitar.c pizz strings", dyn: 0.62, to: 0.42, rit: 0.8 },
    ],
    [
      { s: "intro", play: "motif:horns guitar.c pizz", dyn: 0.52, to: 0.62 },
      { s: "verse", play: "lead:fiddle crew:reed guitar pizz drum", dyn: 0.66 },
      { s: "chorus", play: "mel:fiddle low:reed guitar pizz drum tabor", dyn: 0.7 },
      { s: "bridge", play: "mel:reed-12 strings guitar.c pizz", dyn: 0.66, to: 0.72 },
      { s: "verse", play: "lead2:reed crew:fiddle crew:horns-12 guitar pizz drum tabor", dyn: 0.72 },
      { s: "chorus", play: "mel:reed mel:fiddle low:horns guitar pizz drum.b tabor strings", dyn: 0.72 },
      { s: "outro", play: "tag:fiddle guitar.c pizz strings", dyn: 0.6, to: 0.4, rit: 0.8 },
    ],
  ],
  rest: [25, 45],
};
