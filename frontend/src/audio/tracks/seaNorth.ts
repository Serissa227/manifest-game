// 《北风与白鲸》：北方寒冷的海域（白鲸海、伊斯布伦海、法尔克海、守望海与新大陆北端的霜语海）。
// D 多利亚调式，6/8 拍，比内海慢（附点四分音符每分钟 56 拍），浪大而沉。
// 底下是 D 与 A 的空五度持续音（像风笛、也像冰原上的风），卡恩特勒琴弹分解和弦，大提琴组一小节一个长音；
// 开头圆号在远处吹起帆动机（主题曲的 A → D → A，这里落在小调上）；提琴领奏一条宽的、带多利亚还原 B 的旋律，
// 钢片琴在每小节后半点一颗冰晶似的高音；B 段转到 F 大调一侧，圆号唱号角式的旋律，提琴在高处拉长音，人声“呜——”像北风。
import type { TrackDef } from "../score";

export const SEA_NORTH: TrackDef = {
  id: "sea_north",
  title: { zh: "北风与白鲸", en: "North Wind and White Whales" },
  qpm: 84,
  meter: [6, 8],
  key: "D dorian",
  hall: true,
  voices: {
    fiddle: { inst: "fiddle", gain: 0.66, pan: -0.14, reverb: 0.34 },
    horns: { inst: "horns", gain: 0.58, pan: 0.26, reverb: 0.5 },
    kantele: { inst: "kantele", gain: 0.33, pan: 0.32, reverb: 0.34, pattern: { kind: "arp", low: 50, steps: "1 5 8 10 8 5", ring: 2 } },
    drone: { inst: "drone", gain: 0.5, reverb: 0.3, pattern: { kind: "drone", notes: [38, 45] } },
    celli: { inst: "celli", gain: 0.5, pan: 0.1, reverb: 0.3, pattern: { kind: "arp", low: 38, steps: "b . . . . ." } },
    choir: { inst: "choir", gain: 0.42, pan: -0.2, reverb: 0.6, pattern: { kind: "pad", low: 57, high: 74, size: 3 } },
    celesta: { inst: "celesta", gain: 0.33, pan: 0.4, reverb: 0.6 },
    drum: { inst: "perc", gain: 0.52, pan: 0.05, reverb: 0.3, pattern: { kind: "drum", steps: "D..t..", hits: { D: ["bodhran", 0.55], t: ["tip", 0.3] } } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "Dm | C | Dm | Dm",
      lines: { motif: "z6 | z4 A,3/2 D/2 | A6 | z6" },
    },
    A: {
      bars: 8,
      chords: "Dm | C | Dm | Am | Dm | C | G | Dm",
      lines: {
        mel: "A3 d3 | e3 c2 A | d3 f2 e | e6 | A3 d2 e | g3 e2 c | d3 B2 G | A6",
        // 再奏时加了倚音与回旋音
        mel2: "A3 {e}d3 | ~e3 c2 A | d3 f2 e | e6 | A3 d2 e | g3 {a}e2 c | d3 B2 G | A6",
        // 钢片琴：冰晶
        ice: "z4 a'2 | z4 g'2 | z4 f'2 | z4 e'2 | z4 a'2 | z4 e'2 | z4 d'2 | z6",
      },
    },
    B: {
      bars: 8,
      chords: "F | C | Dm | Am | F | C | G | A",
      lines: {
        // 圆号的号角式旋律
        hmel: "F3 A3 | G3 E3 | F3 D3 | E6 | A3 c3 | c3 G3 | B3 d3 | ^c6",
        // 提琴在高处拉的长音
        desc: "c'6 | c'6 | a6 | a6 | c'6 | e'6 | d'6 | e'6",
      },
    },
    outro: {
      bars: 4,
      chords: "Dm | C | G | Dm",
      lines: { tag: "A3 d3 | e3 c3 | d3 B3 | A6" },
    },
  },
  forms: [
    [
      { s: "intro", play: "motif:horns drone choir celli", dyn: 0.46, to: 0.6 },
      { s: "A", play: "mel:fiddle kantele drone celli drum", dyn: 0.62 },
      { s: "A", play: "mel2:fiddle ice:celesta kantele choir celli drum", dyn: 0.66 },
      { s: "B", play: "hmel:horns desc:fiddle kantele choir celli drum", dyn: 0.64, to: 0.72 },
      { s: "A", play: "mel2:fiddle mel:horns-12 ice:celesta kantele choir celli drone drum", dyn: 0.72 },
      { s: "outro", play: "tag:fiddle kantele drone choir", dyn: 0.56, to: 0.36, rit: 0.8 },
    ],
    [
      { s: "intro", play: "motif:horns drone kantele", dyn: 0.44, to: 0.56 },
      { s: "A", play: "mel:horns-12 kantele drone celli", dyn: 0.6 },
      { s: "A", play: "mel:fiddle ice:celesta kantele choir celli drum", dyn: 0.64 },
      { s: "B", play: "hmel:fiddle kantele choir celli drum", dyn: 0.62, to: 0.7 },
      { s: "A", play: "mel2:fiddle mel:horns-12 ice:celesta kantele choir celli drone drum", dyn: 0.72 },
      { s: "outro", play: "tag:fiddle kantele drone", dyn: 0.54, to: 0.34, rit: 0.8 },
    ],
  ],
  rest: [25, 45],
};
