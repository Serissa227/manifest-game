// 《卡拉维因的芦笛》：学院的短主题·非斯，卡拉维因与儿童学堂（塔里克）。
// A 弗里吉亚（降 B），句尾落在升 C（安达卢西亚—马格里布那种升高的三级：旋律上的终止，不是和弦），6/8 拍（每分钟 96 拍，一遍半分钟）：
// 安达卢西亚努巴的颜色——奈伊笛（芦笛）唱前八小节，乌德琴接后八小节，卡农琴在高处轻轻地弹空五度与八度的分解音，
// 达布卡与小框鼓（用里克鼓）“咚 · · 嗒 · 嗒”，小框鼓的铜钹在三、六拍。
// 地方特色第二阶段重编（旋律与段落不变）：芦笛、乌德琴、卡农琴换成地方乐器的新版（nay、ud、kanun），
// 第二遍由非斯安达卢斯乐队的领奏——拉巴卜（船形的低音弓弦琴）低八度领唱后八小节，乌德琴与它同一个八度异音齐奏；
// 和声不再写西洋的三和弦（原来的弦乐和弦长音拿掉），只有跟着原来的根音走的空五度持续音（A–E、降 B–F、G–D……）。
import type { TrackDef } from "../score";

export const AC_FEZ: TrackDef = {
  id: "ac_fez",
  title: { zh: "卡拉维因的芦笛", en: "The Nay of al-Qarawiyyin" },
  qpm: 96,
  meter: [6, 8],
  key: "A phrygian",
  level: 1.2,
  voices: {
    nay: { inst: "nay", gain: 0.68, pan: -0.12, reverb: 0.38 },
    ud: { inst: "ud", gain: 0.72, pan: 0.16, reverb: 0.28 },
    rabab: { inst: "rabab", gain: 0.62, pan: -0.2, reverb: 0.32 },
    kanun: { inst: "kanun", gain: 0.2, pan: 0.32, reverb: 0.3, pattern: { kind: "arp", low: 57, steps: "1 5 8 5 12 8", ring: 2 } },
    darb: { inst: "perc", gain: 0.24, pan: 0.1, reverb: 0.2, pattern: { kind: "drum", steps: "D..T.t", hits: { D: ["darb_doum", 0.66], T: ["darb_tek", 0.42], t: ["darb_ka", 0.3] } } },
    tar: { inst: "perc", gain: 0.26, pan: -0.3, reverb: 0.22, pattern: { kind: "drum", steps: "..k..kD.k..k", hits: { k: ["riq_ka", 0.32], D: ["riq_dum", 0.4] } } },
    // 衬底（合成）：跟着根音走的空五度持续音、拨奏的低音
    dem: { inst: "drone", gain: 0.14, pan: -0.24, reverb: 0.4, pattern: { kind: "pad", low: 52, high: 69, size: 2 } },
    bass: { inst: "pizz", gain: 0.28, pan: 0.05, reverb: 0.15, pattern: { kind: "arp", low: 36, steps: "1 . . 5, . .", ring: 2 } },
  },
  sections: {
    A: {
      bars: 8,
      // 句尾落在升 C 上（旋律），持续音只有空五度
      chords: "A5 | Bb5 | A5 | G5 | F5 | G5 | Bb5 | A5",
      lines: { mel: "e3 d c B | d3 B A G | c3 B A2 | d3 G3 | c3 A F2 | G3 d3 | f3 d B2 | ^c3 A3" },
    },
    B: {
      bars: 8,
      chords: "D5 | C5 | Bb5 | A5 | D5 | C5 | Bb5 | A5",
      lines: { bmel: "f3 e d2 | e3 c G2 | d3 B F2 | ^c6 | a3 f d2 | g3 e c2 | f3 d B2 | A6" },
    },
  },
  forms: [
    [
      { s: "A", play: "mel:nay kanun bass darb tar", dyn: 0.62 },
      { s: "B", play: "bmel:ud kanun dem bass darb tar", dyn: 0.64, to: 0.6 },
    ],
    [
      { s: "A", play: "mel:ud kanun bass darb", dyn: 0.62 },
      { s: "B", play: "bmel:rabab-12 bmel:ud-12 kanun dem bass darb tar", dyn: 0.64, to: 0.6 },
    ],
  ],
  rest: [8, 14],
};
