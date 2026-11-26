// 《暗涌》：养成篇的事件 · 紧张（被人发现扮作男孩、考试前夜、街上出了事……）。A 小调，4/4，每分钟 100 拍，压着的紧张，不是海战。
// 大提琴组在低处不停地拉一个八分音符的固定音型，每个和弦上都碰一下上方的邻音（A 小调上碰降 B——弗里吉亚的那一点不安），像水面下的暗流；
// 高处弦乐很轻地铺着，定音鼓偶尔一下、句尾滚奏；A 段只有零碎的动机（E → F、升 G）在中音区闪一下就躲开，不成曲调；
// B 段圆号在低处一步步往上走（D → F → A → 升 G……），和声经过降 B 大三和弦（那不勒斯和弦）推到 E 大三和弦，停在悬着的属和弦上。
// 一遍只有一分钟，留白很短：事件等玩家做决定，曲子不该停下来。
import type { TrackDef } from "../score";

/** 大提琴组的固定音型：每个和弦一小节（低音、低音、五音、低音、上方邻音、低音、五音、低音）。 */
const OST: Readonly<Record<string, string>> = {
  Am: "A,,A,,E,A,, _B,,A,,E,A,,",
  F: "F,,F,,C,F,, G,,F,,C,F,,",
  E: "E,,E,,B,,E,, F,,E,,B,,E,,",
  Dm: "D,,D,,A,,D,, E,,D,,A,,D,,",
  Bb: "_B,,B,,F,B,, C,B,,F,B,,",
};

const ost = (chords: string): string =>
  chords
    .split("|")
    .map((c) => OST[c.trim().replace(/7$/, "")])
    .join(" | ");

export const UB_TENSE: TrackDef = {
  id: "ub_tense",
  title: { zh: "暗涌", en: "Undercurrent" },
  qpm: 100,
  meter: [4, 4],
  key: "A minor",
  level: 1.38,
  voices: {
    celli: { inst: "celli", gain: 0.4, pan: 0.16, reverb: 0.26 },
    fiddle: { inst: "fiddle", gain: 0.46, pan: -0.2, reverb: 0.34 },
    violins: { inst: "violins", gain: 0.44, pan: -0.28, reverb: 0.36 },
    horns: { inst: "horns", gain: 0.46, pan: 0.28, reverb: 0.38 },
    air: { inst: "strings", gain: 0.26, pan: -0.1, reverb: 0.5, pattern: { kind: "pad", low: 64, high: 81, size: 3 } },
    timp: { inst: "timpani", gain: 0.38, reverb: 0.32 },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "Am | Am",
      lines: { ost: ost("Am | Am"), timp: "!trem!A,,8- | A,,4 z4" },
    },
    A: {
      bars: 8,
      chords: "Am | Am | F | E | Am | Dm | Bb | E",
      lines: {
        ost: ost("Am | Am | F | E | Am | Dm | Bb | E"),
        // 零碎的动机：闪一下就躲开
        frag: "z8 | z4 E2 F2 | A6 G2 | ^G8 | z8 | z4 F2 G2 | _B6 A2 | ^G4 E4",
        timp: "A,,2 z6 | z8 | z8 | E,,2 z6 | A,,2 z6 | z8 | z8 | !trem!E,,8",
      },
    },
    B: {
      bars: 8,
      chords: "Dm | Am | Dm | E | F | Dm | Bb | E7",
      lines: {
        ost: ost("Dm | Am | Dm | E | F | Dm | Bb | E7"),
        // 一步步往上走，停在悬着的属和弦上
        bline: "D4 F4 | E4 C4 | F4 A4 | ^G6 z2 | A4 c4 | d4 f4 | f4 d4 | e4 ^g4",
        timp: "D,,2 z6 | z8 | D,,2 z6 | !trem!E,,8 | z8 | D,,2 z6 | z8 | !trem!E,,8",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "ost:celli timp:timp", dyn: 0.58, to: 0.64 },
      { s: "A", play: "ost:celli frag:fiddle air timp:timp", dyn: 0.62 },
      { s: "B", play: "ost:celli bline:horns-12 air timp:timp", dyn: 0.64, to: 0.7 },
      { s: "A", play: "ost:celli frag:violins+12 air timp:timp", dyn: 0.66 },
    ],
    [
      { s: "intro", play: "ost:celli air", dyn: 0.58, to: 0.64 },
      { s: "A", play: "ost:celli frag:fiddle timp:timp", dyn: 0.62 },
      { s: "B", play: "ost:celli bline:violins bline:horns-12 air timp:timp", dyn: 0.66, to: 0.72 },
      { s: "A", play: "ost:celli frag:fiddle air timp:timp", dyn: 0.64 },
    ],
  ],
  rest: [3, 6],
};
