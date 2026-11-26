// 《巴西木的海岸》：巴西的港口（萨尔瓦多、奥林达、圣维森特、瓜纳巴拉湾……葡萄牙人来砍染料用的巴西木，岸上是图皮南巴人的村子）。
// 地方特色第二阶段·美洲：图皮的乐器领奏（复古合成版的衬底只有很轻的合成持续音）。旋律原创（不取十六世纪游记里记下的图皮南巴歌）。
// E 多利亚（旋律多在 E 升F G A B 五个音里打转），4/4（每分钟 112 拍）：图皮南巴人围成圈跳舞，一边踏地一边摇姆巴拉卡——
// - 引子：海螺号（图皮人叫 uatapu）一声，巫师（pajé）的姆巴拉卡长长地抖，跺地竹筒“低 · 高 ·”进来，竹笛吹一句；
// - A：竹笛领奏——窄的音域、一句句往下走、重复（图皮的歌就是这样短而反复）；再来时第二支竹笛晚一小节跟着同一句（两支成对的竹笛错开着吹）；
// - B：围圈的舞跳快了（竹筒与沙铃加密），两支竹笛平行四度；再一遍海螺号在下面拉长音；
// - 尾声竹笛一句往下滑落，沙铃长抖收住。
// 和声不用西洋的三和弦：只有空五度的持续音。
import type { TrackDef } from "../score";

export const PORT_BRAZIL: TrackDef = {
  id: "port_brazil",
  title: { zh: "巴西木的海岸", en: "Brazilwood Coast" },
  qpm: 112,
  meter: [4, 4],
  key: "E dorian",
  voices: {
    flute: { inst: "taboca", gain: 0.5, pan: -0.14, reverb: 0.34 },
    flute2: { inst: "taboca", gain: 0.42, pan: 0.18, reverb: 0.36 },
    conch: { inst: "conch", gain: 0.34, pan: -0.04, reverb: 0.5 },
    rattle: {
      inst: "perc",
      gain: 0.28,
      pan: 0.26,
      reverb: 0.24,
      pattern: {
        a: { kind: "drum", steps: "M.m.M.m.", hits: { M: ["mbaraka", 0.6], m: ["mbaraka", 0.36] } },
        b: { kind: "drum", steps: "MmM.MmMm", hits: { M: ["mbaraka", 0.62], m: ["mbaraka", 0.36] } },
        intro: { kind: "drum", steps: "........R.......R...R...M.m.M.m.", hits: { R: ["mbaraka_roll", 0.55], M: ["mbaraka", 0.55], m: ["mbaraka", 0.34] } },
        coda: { kind: "drum", steps: "M.m.M.m.R.......", hits: { M: ["mbaraka", 0.55], m: ["mbaraka", 0.34], R: ["mbaraka_roll", 0.6] } },
      },
    },
    stamp: {
      inst: "perc",
      gain: 0.3,
      pan: -0.06,
      reverb: 0.26,
      pattern: {
        a: { kind: "drum", steps: "T.t.T.t.", hits: { T: ["takuapu", 0.65], t: ["takuapu_hi", 0.45] } },
        b: { kind: "drum", steps: "T.ttT.tt", hits: { T: ["takuapu", 0.7], t: ["takuapu_hi", 0.45] } },
        intro: { kind: "drum", steps: "................T.t.T.t.T.t.T.tt", hits: { T: ["takuapu", 0.6], t: ["takuapu_hi", 0.42] } },
        coda: { kind: "drum", steps: "T.t.T...T.......", hits: { T: ["takuapu", 0.7], t: ["takuapu_hi", 0.45] } },
      },
    },
    // 衬底（合成）：很轻的空五度持续音
    pad: { inst: "drone", gain: 0.13, pan: -0.2, reverb: 0.44, pattern: { kind: "pad", low: 52, high: 71, size: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "E5 | E5 | E5 | E5",
      lines: {
        call: "!bend!E,8 | z8 | z8 | z8",
        tune: "z8 | z8 | B2 B A B4 | A2 G F !fall!E4",
      },
    },
    A: {
      bars: 8,
      chords: "E5 | E5 | E5 | E5 | E5 | E5 | D5 | E5",
      lines: {
        mel: "B2 B A B2 A G | A2 G F E4 | B2 B A B2 d B | A2 G A B4 | e2 d B d2 B A | B2 A G A4 | G2 F E F2 E D | !fall!E8",
        // 第二支竹笛晚一小节跟着同一句
        echo: "z8 | B2 B A B2 A G | A2 G F E4 | B2 B A B2 d B | z8 | e2 d B d2 B A | B2 A G A4 | !fall!E8",
      },
    },
    B: {
      bars: 8,
      chords: "E5 | E5 | A5 | E5 | D5 | E5 | E5 | E5",
      lines: {
        bmel: "E2 E F G2 A2 | B2 A G A4 | B2 B c B2 A G | A2 G F E4 | d2 d B A2 B2 | G2 F E F4 | E2 F G A2 G F | !fall!E8",
        // 海螺号在下面拉长音
        horn: "!bend!E,8 | z8 | !bend!A,8 | z8 | !bend!D,8 | z8 | !bend!E,8 | !fall!E,8",
      },
    },
    coda: {
      bars: 2,
      chords: "E5 | E5",
      lines: { end: "B2 B A !fall!E4 | z8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:conch tune:flute rattle.intro stamp.intro pad", dyn: 0.6, to: 0.66 },
      { s: "A", play: "mel:flute rattle.a stamp.a pad", dyn: 0.66 },
      { s: "A", play: "mel:flute echo:flute2 rattle.a stamp.a pad", dyn: 0.68 },
      { s: "B", play: "bmel:flute bmel:flute2-5 rattle.b stamp.b pad", dyn: 0.7 },
      { s: "B", play: "bmel:flute bmel:flute2-5 horn:conch rattle.b stamp.b pad", dyn: 0.72 },
      { s: "A", play: "mel:flute echo:flute2 rattle.a stamp.a pad", dyn: 0.68, rit: 0.93 },
      { s: "coda", play: "end:flute rattle.coda stamp.coda pad", dyn: 0.66 },
    ],
    [
      { s: "A", play: "mel:flute2 rattle.a stamp.a pad", dyn: 0.64 },
      { s: "B", play: "bmel:flute bmel:flute2-5 rattle.b stamp.b pad", dyn: 0.68 },
      { s: "A", play: "mel:flute echo:flute2 rattle.a stamp.a pad", dyn: 0.7, rit: 0.93 },
      { s: "coda", play: "end:flute rattle.coda stamp.coda pad", dyn: 0.66 },
    ],
  ],
  rest: [10, 18],
  level: 1.42,
};
