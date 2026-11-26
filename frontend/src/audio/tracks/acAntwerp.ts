// 《月桂树下的歌》：学院的短主题·安特卫普（莉芙：“月桂树”女子法语学校，普朗坦的印刷所就在城里）。
// F 大调，4/4（每分钟 112 拍，一遍三十多秒），写成当时安特卫普印的那种法兰德斯—法国式的尚松：开头“长—短短”的步子，四个声部各走各的。
// 地方特色第二阶段（北欧）重编：旋律、和声与段落不变，换成安特卫普自己的声音——
// - 维金纳琴（鲁克斯家族 1579 年起在安特卫普造的 muselar：拨在弦的正中，圆、甜）右手唱旋律、左手弹分解和弦；
// - 再唱一遍时，圣母主教堂钟楼的排钟（beiaard）在高处奏旋律，克鲁姆管吹中声部与低声部（苏萨托 1551 年在安特卫普印的舞曲集里的那种合奏）；
// 衬底（弦乐群、管弦版的中提琴与小提琴）只是很轻的和弦长音。
import type { TrackDef } from "../score";

export const AC_ANTWERP: TrackDef = {
  id: "ac_antwerp",
  title: { zh: "月桂树下的歌", en: "Song under the Laurel" },
  qpm: 112,
  meter: [4, 4],
  key: "F major",
  voices: {
    // 地方乐器（两套编配共用）
    virg: { inst: "virginal", gain: 0.58, pan: -0.1, reverb: 0.26 },
    virgarp: { inst: "virginal", gain: 0.3, pan: -0.02, reverb: 0.26, pattern: { kind: "arp", low: 41, steps: "1 5 8 10 8 5 8 10", ring: 2 } },
    bells: { inst: "beiaard", gain: 0.36, pan: 0.24, reverb: 0.5 },
    crum: { inst: "crumhorn", gain: 0.3, pan: 0.2, reverb: 0.3 },
    crumb: { inst: "crumhorn", gain: 0.34, pan: 0.1, reverb: 0.28 },
    // 衬底（合成）：很轻的弦乐群
    pad: { inst: "strings", gain: 0.11, pan: 0.16, reverb: 0.4, pattern: { kind: "pad", low: 53, high: 69, size: 3 } },
  },
  sections: {
    A: {
      bars: 8,
      chords: "F | C | Dm | Bb C | F | Bb | C | F",
      lines: {
        mel: "c4 A2 A2 | G2 E2 G2 c2 | d3 c B2 A2 | B2 d2 c4 | c4 f2 e2 | d3 c B2 d2 | c2 B2 A2 G2 | F8",
        // 中声部
        alto: "F4 F2 A2 | E2 C2 E2 G2 | F3 E D2 F2 | D2 F2 E4 | A4 A2 c2 | B3 A G2 B2 | A2 G2 F2 E2 | C8",
        // 低声部
        low: "F,4 F,2 F,2 | C4 C,4 | D,4 D,2 F,2 | B,,4 C,4 | F,4 A,2 F,2 | B,,4 B,,2 D,2 | C,4 C,4 | F,,8",
      },
    },
  },
  forms: [
    [
      { s: "A", play: "mel:virg virgarp", dyn: 0.62 },
      { s: "A", play: "mel:bells+12 alto:crum low:crumb virgarp pad", dyn: 0.66, to: 0.6, rit: 0.92 },
    ],
    [
      { s: "A", play: "mel:bells+12 low:crumb pad", dyn: 0.6 },
      { s: "A", play: "mel:virg alto:crum low:crumb virgarp pad", dyn: 0.66, to: 0.6, rit: 0.92 },
    ],
  ],
  rest: [8, 14],
  level: 1.85,
};
