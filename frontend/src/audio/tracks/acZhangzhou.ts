// 《社学的读书声》：学院的短主题·漳州龙溪县的社学（林晚灯）。
// 地方特色第二阶段重编（东亚宫廷）：琴箫合奏——散学以后，先生在窗下抚琴，箫跟着；原来那支闽南小调的旋律放慢、交给琴与箫。
// C 宫五声（C D E G A），4/4（每分钟 66 拍），没有打击乐：
// - 泛起（两小节）：古琴的泛音（轻点徽位，清亮如磬），最后落一声低处的散音（撮：两根空弦同时弹的八度、五度）；
// - A（四小节）：琴在低八度弹按音——绰（从下面滑进本音，!bend!）、注（往下落，!fall!）、吟猱（揉弦，!vib!），
//   长音之后左手在弦上走（走手音：不再起音，只剩余音滑到新的音上），乐句开头的散音托底；
// - B（四小节）：箫进来，与琴同一条旋律的异音（箫拉长、琴碎），句尾琴的余音往下走；第二遍箫先唱、琴奏泛音，最后泛音收住（泛止）。
// 合成版的衬底只是极轻的 C–G 持续音（管弦版换成大提琴组与中提琴的长音）。
import type { TrackDef } from "../score";

export const AC_ZHANGZHOU: TrackDef = {
  id: "ac_zhangzhou",
  title: { zh: "社学的读书声", en: "Recitation at the Village School" },
  qpm: 66,
  meter: [4, 4],
  key: "C major",
  level: 1.3,
  space: 1.15,
  voices: {
    qin: { inst: "guqin", gain: 0.6, pan: -0.1, reverb: 0.4 },
    zou: { inst: "guqin_zou", gain: 0.34, pan: -0.1, reverb: 0.42 },
    fan: { inst: "guqin_fan", gain: 0.4, pan: -0.16, reverb: 0.5 },
    xiao: { inst: "xiao", gain: 0.5, pan: 0.18, reverb: 0.46 },
    // 衬底（合成）：极轻的 C–G 持续音，散音处一下低音拨奏
    bed: { inst: "drone", gain: 0.08, pan: 0.04, reverb: 0.5, pattern: { kind: "drone", notes: [36, 43] } },
    thud: { inst: "pizz", gain: 0.14, pan: 0.08, reverb: 0.32 },
  },
  sections: {
    intro: {
      bars: 2,
      lines: {
        // 泛音：G c A G | E G c
        fan: "G2 c3 A G2 | E2 G2 c4",
        san: "z8 | z4 [C,,G,,]4",
      },
    },
    A: {
      bars: 4,
      lines: {
        // 原来那支小调的旋律（读书声），放慢；琴在低八度弹（-12），箫在原音区
        qin: "!bend!G2 A/2G/2E !vib!c2 A2 | A2 c/2A/2G !vib!E4 | D2 E/2G/2A !fall!G2 D2 | !vib!E6 z2",
        zou: "z8 | z6 !bend!G2 | z8 | z4 !bend!G2 !slide!E2",
        san: "[C,,C,]2 z6 | z8 | [D,,A,,]2 z6 | z4 [C,,G,,]4",
        low: "C,,2 z6 | z8 | D,,2 z6 | z4 C,,4",
        xiao: "!bend!G3 E c2 !vib!A2 | A2 G2 !vib!E4 | D3 A !bend!G2 D2 | !vib!E6 z2",
        // 泛音段（第二遍）：同一条旋律奏成泛音
        fan: "G2 A/2G/2E c2 A2 | A2 c/2A/2G E4 | D2 E/2G/2A G2 D2 | E6 z2",
      },
    },
    B: {
      bars: 4,
      lines: {
        qin: "!bend!c2 d/2c/2A c2 !bend!e2 | d2 e/2d/2c !vib!A2 D2 | G2 A2 !vib!c2 A2 | G2 !fall!E2 !vib!C4",
        zou: "z8 | z8 | z6 !fall!A2 | z8",
        san: "[C,,C,]2 z6 | z8 | [G,,D,]2 z6 | z4 [C,,C,]4",
        low: "C,,2 z6 | z8 | G,,2 z6 | z4 C,,4",
        xiao: "c3 A c2 !bend!e2 | !vib!d4 A2 D2 | G2 A2 !vib!c4 | G2 E2 !vib!C4",
        // 泛止：最后一小节泛音的五度
        fin: "z8 | z8 | z8 | z4 [Gc]4",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "fan:fan san:qin bed", dyn: 0.56, tempo: 0.9 },
      { s: "A", play: "qin:qin-12 zou:zou-12 san:qin bed low:thud", dyn: 0.62 },
      { s: "B", play: "qin:qin-12 zou:zou-12 san:qin xiao:xiao bed low:thud", dyn: 0.64, to: 0.56, rit: 0.85 },
    ],
    [
      { s: "A", play: "xiao:xiao fan:fan san:qin bed low:thud", dyn: 0.6 },
      { s: "B", play: "qin:qin-12 zou:zou-12 san:qin xiao:xiao fin:fan bed low:thud", dyn: 0.62, to: 0.54, rit: 0.85 },
    ],
  ],
  rest: [8, 14],
};
