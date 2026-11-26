// 《巴西海流》：巴西沿岸的海（巴西海流、诸圣湾外、瓜纳巴拉湾外的南大西洋沿岸）——寰宇世界的航海曲。
// 图皮南巴人的大独木舟（igara）贴着海岸走，几十个桨手一边划一边唱：领唱的人唱一句，桨手们接一句。
// 地方特色第二阶段·美洲：图皮的乐器领奏（复古合成版的衬底只有很轻的合成持续音）。旋律原创（不取十六世纪游记里记下的图皮南巴歌）。
// D 多利亚（旋律多在 D F G A C 五个音里打转，E 只是经过），慢 4/4（每分钟 90 拍）——划桨的节奏：
// 塔夸普竹筒顿在船板上，一小节两下（第一拍低、第三拍高，桨落水的两下），姆巴拉卡每拍一摇，每两小节的末尾长长地抖一下，像一道浪涌过来。
// 一律是匀的二拍子，没有爱尔兰吉格式的“咚 · · 嗒 · 嗒”，也没有西班牙式的三对二。
// - 引子：远处海螺号（图皮人叫 uatapu）两声，沙铃长抖，竹筒进来，第二支竹笛吹一句；
// - A：领唱（竹笛）唱一句，桨手们（第二支竹笛）接一句——短、窄、重复、一句句往下走、句尾滑落；再来时领唱跟着一起唱，第二支竹笛在下方四度接；
// - B：开到外海，旋律高一些、长一些，两支竹笛平行四度（成对的竹笛），海螺号在下面拉 D 与 A 的长音，沙铃加密；
// - 尾声：最后一句往下滑落，海螺号再吹一声，沙铃长抖收住。
// 和声只有空五度（D–A、C–G、A–E）：图皮人的歌没有西洋的三和弦；两支竹笛之间只有同度与四度（americas.test 逐音查旋律声部之间的三度、六度）。
// 经典世界的《阿斯特里亚的海岸》（sea_new，新大陆沿岸）一个音不动，这一首与它无关。
import type { TrackDef } from "../score";

export const SEA_BRAZIL: TrackDef = {
  id: "sea_brazil",
  title: { zh: "巴西海流", en: "The Brazil Current" },
  qpm: 90,
  meter: [4, 4],
  key: "D dorian",
  voices: {
    flute: { inst: "taboca", gain: 0.5, pan: -0.14, reverb: 0.36 },
    flute2: { inst: "taboca", gain: 0.42, pan: 0.2, reverb: 0.38 },
    conch: { inst: "conch", gain: 0.32, pan: 0.06, reverb: 0.55 },
    rattle: {
      inst: "perc",
      gain: 0.28,
      pan: 0.28,
      reverb: 0.26,
      pattern: {
        // 每拍一摇（重 · 轻），每两小节的末拍长抖一下
        a: { kind: "drum", steps: "M.m.M.m.M.m.R...", hits: { M: ["mbaraka", 0.55], m: ["mbaraka", 0.32], R: ["mbaraka_roll", 0.42] } },
        b: { kind: "drum", steps: "MmM.MmM.MmM.R...", hits: { M: ["mbaraka", 0.58], m: ["mbaraka", 0.32], R: ["mbaraka_roll", 0.46] } },
        intro: { kind: "drum", steps: "R.......R.......M.m.M.m.M.m.R...", hits: { R: ["mbaraka_roll", 0.45], M: ["mbaraka", 0.5], m: ["mbaraka", 0.3] } },
        coda: { kind: "drum", steps: "M.m.M.m.M.m.R...M.m.M.m.R.......", hits: { M: ["mbaraka", 0.5], m: ["mbaraka", 0.3], R: ["mbaraka_roll", 0.5] } },
      },
    },
    stamp: {
      inst: "perc",
      gain: 0.33,
      pan: -0.08,
      reverb: 0.28,
      pattern: {
        // 划桨：第一拍低、第三拍高
        a: { kind: "drum", steps: "T...t...", hits: { T: ["takuapu", 0.62], t: ["takuapu_hi", 0.42] } },
        intro: { kind: "drum", steps: "................T...t...T...t...", hits: { T: ["takuapu", 0.58], t: ["takuapu_hi", 0.4] } },
        coda: { kind: "drum", steps: "T...t...T...t...T.......T.......", hits: { T: ["takuapu", 0.6], t: ["takuapu_hi", 0.4] } },
      },
    },
    // 衬底（合成）：很轻的空五度持续音
    pad: { inst: "drone", gain: 0.12, pan: -0.2, reverb: 0.46, pattern: { kind: "pad", low: 50, high: 69, size: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "D5 | D5 | D5 | D5",
      lines: {
        call: "!bend!D,6 z2 | z8 | !bend!A,,6 z2 | z8",
        tune: "z8 | z8 | c2 c2 A4 | G2 F2 !fall!D4",
      },
    },
    A: {
      bars: 8,
      chords: "D5 | D5 | D5 | D5 | D5 | C5 | D5 | D5",
      lines: {
        // 领唱一句、桨手们接一句（合起来是 mel）
        call: "c2 c2 A4 | G2 A G F4 | z8 | z8 | d2 d c A4 | c2 A2 G4 | z8 | z8",
        resp: "z8 | z8 | A2 A2 G4 | F2 G F !fall!D4 | z8 | z8 | A2 G F G2 E2 | !fall!D8",
        mel: "c2 c2 A4 | G2 A G F4 | A2 A2 G4 | F2 G F !fall!D4 | d2 d c A4 | c2 A2 G4 | A2 G F G2 E2 | !fall!D8",
      },
    },
    B: {
      bars: 8,
      chords: "D5 | D5 | D5 | A5 | C5 | C5 | D5 | D5",
      lines: {
        bmel: "d2 d c d2 f2 | d2 c A c4 | d2 d c A2 G2 | !vib!A8 | c2 c A c2 A2 | G2 A G F4 | G2 F D F2 E2 | !fall!D8",
        // 海螺号在下面拉长音（只有 D 与 A 两个音）
        horn: "!bend!D,8 | z8 | z8 | !bend!A,,8 | z8 | z8 | !bend!D,8 | !fall!D,8",
      },
    },
    outro: {
      bars: 4,
      chords: "D5 | D5 | D5 | D5",
      lines: {
        tag: "A2 A2 G4 | F2 G F !fall!D4 | z8 | z8",
        call: "z8 | z8 | !bend!D,8 | !fall!D,6 z2",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:conch tune:flute2 rattle.intro stamp.intro pad", dyn: 0.56, to: 0.64 },
      { s: "A", play: "call:flute resp:flute2 rattle.a stamp.a pad", dyn: 0.64 },
      { s: "A", play: "mel:flute resp:flute2-5 rattle.a stamp.a pad", dyn: 0.66 },
      { s: "B", play: "bmel:flute bmel:flute2-5 horn:conch rattle.b stamp.a pad", dyn: 0.68, to: 0.72 },
      { s: "A", play: "call:flute resp:flute2 rattle.a stamp.a pad", dyn: 0.68 },
      { s: "outro", play: "tag:flute call:conch rattle.coda stamp.coda pad", dyn: 0.62, to: 0.42, rit: 0.86 },
    ],
    [
      { s: "intro", play: "call:conch tune:flute rattle.intro stamp.intro pad", dyn: 0.54, to: 0.62 },
      { s: "A", play: "mel:flute2 rattle.a stamp.a pad", dyn: 0.62 },
      { s: "B", play: "bmel:flute rattle.b stamp.a pad", dyn: 0.66 },
      { s: "B", play: "bmel:flute bmel:flute2-5 horn:conch rattle.b stamp.a pad", dyn: 0.7, to: 0.72 },
      { s: "A", play: "mel:flute resp:flute2-5 rattle.a stamp.a pad", dyn: 0.68 },
      { s: "outro", play: "tag:flute2 call:conch rattle.coda stamp.coda pad", dyn: 0.6, to: 0.4, rit: 0.86 },
    ],
  ],
  rest: [25, 45],
  level: 1.42,
};
