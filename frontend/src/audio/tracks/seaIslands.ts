// 《信风群岛》：南洋群岛之间（拉玛塔海、马纳瓦海）。F 大调的五声旋律，6/8 拍，暖、明亮、晃悠悠：
// 四弦小吉他“下 · 上 下 · 上”地扫，低音拨奏落在第一、四拍，沙锤一直沙沙地走，群岛的大鼓只在第一拍轻轻一下。
// 开头鼻笛吹起帆动机（C → F → C）；A 段鼻笛领奏，重复时交给木琴；B 段升到 D 小调一侧，木琴在下面按和弦音配一条和声，
// 人声“哦——”铺在后面，像信风吹过椰林。旋律只用五声音阶（F G A C D），与港口曲《珊瑚潮》同一种风味，律动是航海曲的 6/8。
import type { TrackDef } from "../score";

export const SEA_ISLANDS: TrackDef = {
  id: "sea_islands",
  title: { zh: "信风群岛", en: "Isles of the Trade Wind" },
  qpm: 100,
  meter: [6, 8],
  key: "F major",
  voices: {
    vivo: { inst: "vivo", gain: 0.72, pan: -0.14, reverb: 0.32 },
    marimba: { inst: "marimba", gain: 0.42, pan: 0.24, reverb: 0.28 },
    uke: { inst: "ukulele", gain: 0.17, pan: 0.3, reverb: 0.2, pattern: { kind: "strum", low: 60, high: 76, steps: "D . u D . u", spread: 0.009 } },
    bass: { inst: "pizz", gain: 0.36, pan: 0, reverb: 0.15, pattern: { kind: "arp", low: 36, steps: "1 . . 5, . .", ring: 2 } },
    choir: { inst: "choir", gain: 0.4, pan: -0.25, reverb: 0.55, pattern: { kind: "pad", low: 60, high: 76, size: 3 } },
    shaker: { inst: "perc", gain: 0.5, pan: -0.35, reverb: 0.15, pattern: { kind: "drum", steps: "Sss Sss", hits: { S: ["shaker", 0.5], s: ["shaker", 0.3] } } },
    pahu: { inst: "perc", gain: 0.2, pan: 0.05, reverb: 0.25, pattern: { kind: "drum", steps: "P..p..", hits: { P: ["pahu", 0.75], p: ["pahu", 0.4] } } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "F | Bb | F | C",
      lines: { motif: "z6 | z4 C3/2 F/2 | c6 | z6" },
    },
    A: {
      bars: 8,
      chords: "F | F | Bb | F | Dm | C | Bb C | F",
      lines: {
        mel: "A3 c2 d | c3 A3 | d3 d2 c | A6 | A3 G2 F | G3 c3 | d3 c2 G | F6",
      },
    },
    B: {
      bars: 8,
      chords: "Dm | Bb | F | C | Dm | Bb | C | F",
      lines: {
        mel: "f3 d2 c | d3 f3 | c3 A2 G | G6 | A3 d2 f | f3 d2 c | c3 G2 A | F6",
        // 木琴在下面配的和声（按和弦音走）
        harm: "d3 A2 A | B3 d3 | A3 F2 F | E6 | F3 A2 d | d3 B2 A | G3 E2 F | C6",
      },
    },
    outro: {
      bars: 4,
      chords: "Bb | C | Dm C | F",
      lines: { tag: "d3 c2 A | G3 c3 | d3 c3 | F6" },
    },
  },
  forms: [
    [
      { s: "intro", play: "motif:vivo uke shaker pahu", dyn: 0.56, to: 0.64 },
      { s: "A", play: "mel:vivo uke bass shaker pahu", dyn: 0.66 },
      { s: "A", play: "mel:marimba uke bass shaker pahu", dyn: 0.66 },
      { s: "B", play: "mel:vivo harm:marimba uke bass shaker pahu choir", dyn: 0.68, to: 0.72 },
      { s: "B", play: "mel:marimba harm:vivo uke bass shaker pahu choir", dyn: 0.7 },
      { s: "A", play: "mel:vivo mel:marimba uke bass shaker pahu choir", dyn: 0.72 },
      { s: "outro", play: "tag:vivo uke bass", dyn: 0.6, to: 0.4, rit: 0.85 },
    ],
    [
      { s: "intro", play: "motif:vivo uke shaker", dyn: 0.52, to: 0.6 },
      { s: "A", play: "mel:marimba uke bass shaker", dyn: 0.62 },
      { s: "A", play: "mel:vivo uke bass shaker pahu", dyn: 0.66 },
      { s: "B", play: "mel:vivo harm:marimba uke bass shaker pahu choir", dyn: 0.68, to: 0.72 },
      { s: "B", play: "mel:vivo mel:marimba-12 uke bass shaker pahu choir", dyn: 0.7 },
      { s: "A", play: "mel:vivo mel:marimba uke bass shaker pahu choir", dyn: 0.72 },
      { s: "outro", play: "tag:marimba uke bass", dyn: 0.58, to: 0.38, rit: 0.85 },
    ],
  ],
  rest: [25, 45],
};
