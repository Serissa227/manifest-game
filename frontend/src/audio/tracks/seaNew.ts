// 《阿斯特里亚的海岸》：新大陆沿岸（银雾海、翡翠海、赤礁海）。A 混合利底亚调式，6/8 拍，开阔、有点野、满怀希望。
// 吉他“下 · 上 下 · 上”地扫，大提琴落在第一、四拍，框鼓推着走；开头圆号吹起帆动机（E → A → E），像望见了一条新海岸；
// A 段提琴领奏（第一句一口气爬上 C#、E，第二句停在 G 还原——混合利底亚的“拓荒”色彩），重复时交给西特琴；
// B 段转到 D 大调一侧，圆号在中音区唱一条下行的内声部；最后全奏时木笛在高八度与提琴齐奏。
// 与营火边的《拓荒者的篝火》（A 多利亚、慢圆舞）同属开拓者的风味，这一首是在船上、望着海岸线的心情。
import type { TrackDef } from "../score";

export const SEA_NEW: TrackDef = {
  id: "sea_new",
  title: { zh: "阿斯特里亚的海岸", en: "Shores of Astria" },
  qpm: 100,
  meter: [6, 8],
  key: "A mixolydian",
  voices: {
    fiddle: { inst: "fiddle", gain: 0.6, pan: -0.14, reverb: 0.3 },
    flute: { inst: "flute", gain: 0.44, pan: 0.26, reverb: 0.34 },
    cittern: { inst: "cittern", gain: 0.36, pan: -0.24, reverb: 0.26 },
    horns: { inst: "horns", gain: 0.5, pan: 0.3, reverb: 0.45 },
    guitar: { inst: "guitar", gain: 0.14, pan: 0.3, reverb: 0.22, pattern: { kind: "strum", low: 40, high: 64, steps: "D . u D . u" } },
    cello: { inst: "cello", gain: 0.44, pan: 0.05, reverb: 0.22, pattern: { kind: "arp", low: 40, steps: "1 . . 5, . ." } },
    strings: { inst: "strings", gain: 0.44, pan: -0.2, reverb: 0.4, pattern: { kind: "pad", low: 57, high: 74, size: 3 } },
    drum: { inst: "perc", gain: 0.4, pan: 0.1, reverb: 0.22, pattern: { kind: "drum", steps: "D..T.t", hits: { D: ["bodhran", 0.6], T: ["bodhran", 0.38], t: ["tip", 0.3] } } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "A | G | A | A",
      lines: { motif: "z6 | z4 E,3/2 A,/2 | E6 | z6" },
    },
    A: {
      bars: 8,
      chords: "A | G | D | A | A | G | Em | A",
      lines: {
        mel: "A3 c2 e | d3 B2 G | F3 A2 d | c6 | e3 c2 A | B3 d2 g | g3 f2 e | e6",
      },
    },
    B: {
      bars: 8,
      chords: "D | A | Bm | F#m | G | D | Em | A",
      lines: {
        mel: "f3 f2 e | e3 c3 | d3 B2 F | A6 | B3 d2 g | a3 f2 d | e3 d2 B | A6",
        // 圆号的内声部：一条慢慢下行的线
        low: "A,6 | C6 | D6 | C6 | B,6 | A,6 | G,6 | A,6",
      },
    },
    outro: {
      bars: 4,
      chords: "G | D | A | A",
      lines: { tag: "d3 B2 G | A3 F2 D | E3 c3 | A6" },
    },
  },
  forms: [
    [
      { s: "intro", play: "motif:horns guitar cello drum", dyn: 0.56, to: 0.64 },
      { s: "A", play: "mel:fiddle guitar cello drum", dyn: 0.66 },
      { s: "A", play: "mel:cittern guitar cello drum strings", dyn: 0.66 },
      { s: "B", play: "mel:fiddle low:horns guitar cello drum strings", dyn: 0.68, to: 0.74 },
      { s: "B", play: "mel:fiddle mel:cittern low:horns guitar cello drum strings", dyn: 0.7 },
      { s: "A", play: "mel:fiddle mel:flute+12 guitar cello drum strings", dyn: 0.74 },
      { s: "outro", play: "tag:fiddle guitar cello", dyn: 0.6, to: 0.4, rit: 0.85 },
    ],
    [
      { s: "intro", play: "motif:horns guitar cello", dyn: 0.54, to: 0.62 },
      { s: "A", play: "mel:cittern guitar cello drum", dyn: 0.64 },
      { s: "A", play: "mel:fiddle guitar cello drum strings", dyn: 0.66 },
      { s: "B", play: "mel:horns-12 guitar cello drum strings", dyn: 0.68, to: 0.72 },
      { s: "B", play: "mel:fiddle low:horns guitar cello drum strings", dyn: 0.72 },
      { s: "A", play: "mel:fiddle mel:flute+12 guitar cello drum strings", dyn: 0.74 },
      { s: "outro", play: "tag:cittern guitar cello", dyn: 0.58, to: 0.38, rit: 0.85 },
    ],
  ],
  rest: [25, 45],
};
