// 《侯爵府的维韦拉》：学院的短主题·塞维利亚，塔里法侯爵的府邸（诺埃尔做侍童的地方：拉丁、写字、骑马、剑术与舞蹈）。
// D 小调，慢 4/4（每分钟 80 拍，一遍半分钟多），一段帕凡舞——长—短—短的庄重步子；第二段经过降 B、F，落在 A 大三和弦（升 C）再回到 D 小。
// 第九批配乐·地方特色第二阶段重编：真的维韦拉琴与维奥尔琴（合成的地方乐器）领奏，原来借吉他、提琴与大提琴的音色都换掉了，旋律与和声不变：
// - 第一遍：维韦拉琴独奏帕凡舞，低音维奥尔一拍半一个长音；再来时高音维奥尔唱第二段，第二把维韦拉琴弹分解和弦；
// - 第二遍：高音维奥尔奏第一段的“装饰变奏”（glosas：奥尔蒂斯 1553 年《装饰法》的写法，把长音拆成一串八分音符的经过句），
//   维韦拉琴弹分解和弦，塔博鼓极轻地敲帕凡舞的“长—短—短”；第二段回到维韦拉琴独奏。
// 弦乐群只做极轻的衬底（管弦版换成真的中提琴与大提琴组）。与航海曲《亚得里亚的帆影》的帕凡舞不同：这里是室内的、一把琴与几把维奥尔，不用铜管。
import type { TrackDef } from "../score";

export const AC_SEVILLE: TrackDef = {
  id: "ac_seville",
  title: { zh: "侯爵府的维韦拉", en: "Vihuela in the Marquis's Palace" },
  qpm: 80,
  meter: [4, 4],
  key: "D minor",
  level: 1.45,
  voices: {
    vihuela: { inst: "vihuela", gain: 0.82, pan: -0.1, reverb: 0.3 },
    arp: { inst: "vihuela", gain: 0.32, pan: 0.2, reverb: 0.3, pattern: { kind: "arp", low: 45, steps: "1 5 8 10 8 5 8 5", ring: 2 } },
    viol: { inst: "gamba", gain: 0.5, pan: 0.16, reverb: 0.32 },
    bass: { inst: "gamba", gain: 0.4, pan: 0.24, reverb: 0.26, pattern: { kind: "arp", low: 38, steps: "1 . . . 5, . . ." } },
    drum: { inst: "perc", gain: 0.18, pan: -0.06, reverb: 0.3, pattern: { kind: "drum", steps: "X...x.x.", hits: { X: ["tambori_soft", 0.4], x: ["tambori_soft", 0.26] } } },
    // 衬底（合成）：极轻的弦乐长音
    strings: { inst: "strings", gain: 0.16, pan: -0.2, reverb: 0.4, pattern: { kind: "pad", low: 55, high: 70, size: 3 } },
  },
  sections: {
    A: {
      bars: 8,
      chords: "Dm | A | Dm | C | F | Gm | A | Dm",
      lines: {
        mel: "A4 F2 A2 | ^c4 E2 A2 | d4 c2 B2 | c4 G2 E2 | F4 A2 c2 | B4 A2 G2 | A4 ^c2 e2 | d8",
        // 装饰变奏（glosas）：骨干音落在原来的位置，中间填上经过音与邻音；
        // 第 7 小节在 A 大三和弦上，经过音写还原 B（临时升降 musica ficta：A — B — 升C — D 级进，不出降 B 到升 C 的增二度）
        glosa: "A3 G F E F A | ^c d e ^c E2 A2 | d e f d c2 B2 | c B c d c G E G | F G A F A B c A | B c d B A2 G2 | A =B ^c d e2 ^c2 | d8",
      },
    },
    B: {
      bars: 4,
      chords: "Bb | F | Gm A | Dm",
      lines: { bmel: "d4 B2 F2 | c4 A2 F2 | G2 B2 A2 ^c2 | d8" },
    },
  },
  forms: [
    [
      { s: "A", play: "mel:vihuela bass", dyn: 0.62 },
      { s: "B", play: "bmel:viol arp bass strings", dyn: 0.64, to: 0.58, rit: 0.9 },
    ],
    [
      { s: "A", play: "glosa:viol arp bass drum strings", dyn: 0.62 },
      { s: "B", play: "bmel:vihuela bass", dyn: 0.62, to: 0.56, rit: 0.9 },
    ],
  ],
  rest: [8, 14],
};
