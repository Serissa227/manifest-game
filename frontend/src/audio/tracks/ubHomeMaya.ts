// 《蜂蜜与可可的院子》：养成篇·家乡的日常——玛雅（伊希的科苏梅尔：岛上的院子里吊着吊床，树洞做的蜂箱养着没有刺的蜜蜂，可可豆在石板上磨）。旋律原创。
// F 大调的五声（F G A C D，不用 降B 与 E），4/4（每分钟 84 拍），慢慢地摇：
// - 引子：天亮时海螺号吹一声（音头从下面推上来），葫芦沙铃进来，陶笛吹养成篇的成长动机（C → F → G → A：5 → 1 → 2 → 3）；
// - A：陶笛唱主题，屯库尔木鼓（两片舌头：根音与五度）在下面一拍一拍地应；再一遍第二支陶笛在下方四度、五度跟着（玛雅的双管陶笛），龟甲加进来；
// - B：奇里米亚木管（修士带来的肖姆管，吹它的是玛雅的乐师）在低一些的地方唱一段，帕克斯鼓（手打的立鼓）轻轻地拍；
// - A″：全体，尾声海螺号再吹一声。
// 和声不用西洋的三和弦：只有空五度的持续音（F–C、C–G、G–D、D–A）——五声音阶里的每个音放在这几个空五度上都不刺耳。
// 衬底（合成的持续音与很轻的拨奏）管弦版换成很轻的弦乐。
import type { TrackDef } from "../score";

export const UB_HOME_MAYA: TrackDef = {
  id: "ub_home_maya",
  title: { zh: "蜂蜜与可可的院子" },
  qpm: 84,
  meter: [4, 4],
  key: "F major",
  voices: {
    oc: { inst: "ocarina", gain: 0.48, pan: -0.1, reverb: 0.36 },
    oc2: { inst: "ocarina", gain: 0.36, pan: 0.16, reverb: 0.36 },
    chiri: { inst: "chirimia", gain: 0.36, pan: 0.04, reverb: 0.34 },
    conch: { inst: "conch", gain: 0.34, pan: -0.06, reverb: 0.5 },
    // 屯库尔木鼓：两片舌头，根音与五度
    tk: { inst: "tunkul", gain: 0.42, pan: 0.2, reverb: 0.26, pattern: { kind: "arp", low: 41, steps: "1 . 5 . . 1 5 .", ring: 1 } },
    sonaja: { inst: "perc", gain: 0.2, pan: -0.3, reverb: 0.22, pattern: { kind: "drum", steps: "s.s.s.ss", hits: { s: ["sonaja", 0.36] } } },
    ayotl: { inst: "perc", gain: 0.24, pan: 0.3, reverb: 0.24, pattern: { kind: "drum", steps: "h...l.h.", hits: { h: ["ayotl_hi", 0.44], l: ["ayotl_lo", 0.5] } } },
    pax: { inst: "perc", gain: 0.26, pan: 0.08, reverb: 0.24, pattern: { kind: "drum", steps: "P...p.P.", hits: { P: ["pax", 0.52], p: ["pax_slap", 0.34] } } },
    // 衬底（合成）：很轻的空五度持续音与拨奏
    dem: { inst: "drone", gain: 0.12, pan: -0.2, reverb: 0.44, pattern: { kind: "pad", low: 53, high: 69, size: 2 } },
    pz: { inst: "pizz", gain: 0.16, pan: 0.06, reverb: 0.16, pattern: { kind: "arp", low: 36, steps: "1 . . . . . . .", ring: 4 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "F5 | F5",
      lines: {
        call: "!bend!C6 z2 | z8",
        // 成长动机：C → F → G → A
        mot: "z8 | C2 F2 G2 A2",
      },
    },
    A: {
      bars: 8,
      chords: "F5 | F5 | C5 | G5 | F5 | D5 | C5 | F5",
      lines: {
        mel: "c2 A2 c d c2 | A2 G2 F4 | G2 A c d2 c2 | d6 z2 | f2 d2 c d c2 | d2 c A G2 A2 | c2 A G F2 G2 | F8",
        // 第二支陶笛：多在下方四度、五度
        alt: "F2 F2 G A G2 | F2 D2 C4 | C2 D F G2 G2 | G6 z2 | c2 A2 G A G2 | A2 G F D2 F2 | G2 F D C2 D2 | C8",
      },
    },
    B: {
      bars: 8,
      chords: "C5 | C5 | D5 | D5 | F5 | G5 | C5 | C5",
      lines: { bm: "G2 G A c2 A2 | G2 F D C4 | D2 F G A2 G2 | A6 z2 | c2 A G F2 G2 | D2 F G A4 | G2 F D C2 D2 | C8" },
    },
    coda: {
      bars: 2,
      chords: "F5 | F5",
      lines: { cd: "c2 A G F4 | F8", call: "z8 | !bend!C6 z2" },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:conch mot:oc sonaja dem", dyn: 0.54 },
      { s: "A", play: "mel:oc tk dem", dyn: 0.58 },
      { s: "A", play: "mel:oc alt:oc2 tk sonaja ayotl pz dem", dyn: 0.62 },
      { s: "B", play: "bm:chiri tk pax ayotl dem", dyn: 0.6 },
      { s: "A", play: "mel:oc alt:oc2 tk sonaja ayotl pax pz dem", dyn: 0.66 },
      { s: "coda", play: "cd:oc call:conch tk dem", dyn: 0.58, to: 0.44, rit: 0.86 },
    ],
    [
      { s: "intro", play: "call:conch sonaja dem", dyn: 0.52 },
      { s: "A", play: "mel:oc2 tk sonaja dem", dyn: 0.58 },
      { s: "B", play: "bm:oc tk ayotl dem", dyn: 0.58 },
      { s: "A", play: "mel:oc alt:oc2 tk sonaja ayotl pz dem", dyn: 0.62 },
      { s: "B", play: "bm:chiri bm:oc2 tk pax ayotl pz dem", dyn: 0.62 },
      { s: "A", play: "mel:oc alt:oc2 tk sonaja ayotl pax pz dem", dyn: 0.66 },
      { s: "coda", play: "cd:oc call:conch tk dem", dyn: 0.58, to: 0.44, rit: 0.86 },
    ],
  ],
  rest: [10, 16],
  level: 1.12,
};
