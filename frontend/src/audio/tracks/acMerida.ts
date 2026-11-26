// 《修院的晨课》：学院的短主题·梅里达的方济各会修院与学校（伊希）。
// D 多利亚（素歌的第一调式），慢 4/4（每分钟 66 拍，一遍半分钟上下）：开头修院的钟一响，
// 前四小节是像格里高利圣咏那样的一条单旋律（人声齐唱，只在 D、E、F、G、A 上平平地走），后四小节玛雅的陶笛用五声音阶接过来，
// 屯库尔木鼓、龟甲与葫芦沙铃很轻地跟着——两种声音在同一个院子里；再唱一遍时两条线叠在一起。低处是空五度的长音（像奥尔加农）。
// 地方特色第二阶段·美洲重编（旋律、和声与曲式不变；以前陶笛是竖笛、木鼓是旧的裂缝鼓、沙铃是沙锤，现在换成玛雅的乐器）：
// 再唱一遍时，后四小节的圣咏由奇里米亚木管吹——十六世纪修士把肖姆管带进尤卡坦的教堂，吹它的是玛雅的乐师——
// 同时第二支陶笛吹玛雅的那一句：修士的歌由玛雅人吹，两种声音真的交织在一起。
import type { TrackDef } from "../score";

export const AC_MERIDA: TrackDef = {
  id: "ac_merida",
  title: { zh: "修院的晨课", en: "Matins at the Convent" },
  qpm: 66,
  meter: [4, 4],
  key: "D dorian",
  level: 1.65,
  space: 1.2,
  voices: {
    chant: { inst: "choir", gain: 0.66, pan: -0.06, reverb: 0.55 },
    flute: { inst: "ocarina", gain: 0.62, pan: 0.2, reverb: 0.44 },
    flute2: { inst: "ocarina", gain: 0.52, pan: 0.3, reverb: 0.46 },
    chirimia: { inst: "chirimia", gain: 0.48, pan: -0.16, reverb: 0.5 },
    bell: { inst: "bell", gain: 0.36, pan: -0.32, reverb: 0.7 },
    organum: { inst: "drone", gain: 0.22, pan: 0.06, reverb: 0.46, pattern: { kind: "pad", low: 38, high: 50, size: 2 } },
    slit: { inst: "tunkul", gain: 0.42, pan: 0.26, reverb: 0.3 },
    shell: { inst: "perc", gain: 0.16, pan: -0.24, reverb: 0.32, pattern: { kind: "drum", steps: "........h...l...", hits: { h: ["ayotl_hi", 0.4], l: ["ayotl_lo", 0.36] } } },
    rattle: { inst: "perc", gain: 0.24, pan: 0.32, reverb: 0.3, pattern: { kind: "drum", steps: "..s...s.", hits: { s: ["sonaja", 0.3] } } },
  },
  sections: {
    intro: { bars: 1, chords: "D5", lines: { bell: "D8" } },
    A: {
      bars: 8,
      chords: "D5 | F | C | D5 | D5 | F | G5 | D5",
      lines: {
        // 圣咏
        chant: "D2 F2 E2 D2 | F2 G2 A4 | G2 F2 E2 D2 | D8 | z8 | z8 | z8 | z8",
        // 陶笛（五声音阶）
        flute: "z8 | z8 | z8 | z8 | a2 c'2 a2 g2 | f4 d4 | f2 g2 a2 g2 | d8",
        // 再来一遍时叠在一起的两条
        chant2: "z8 | z8 | z8 | z8 | D2 E2 F2 D2 | F4 A4 | G2 F2 G2 A2 | D8",
        flute2: "z4 a4 | c'6 a2 | g4 f4 | a8 | z8 | z8 | z8 | z8",
        slit: "z8 | z8 | z8 | z8 | D,2 z2 A,,2 z2 | D,2 z2 A,,2 z2 | D,2 z2 A,,2 z2 | D,2 z6",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "bell:bell organum", dyn: 0.54 },
      { s: "A", play: "chant:chant flute:flute slit:slit organum rattle shell", dyn: 0.6, to: 0.56 },
    ],
    [
      { s: "A", play: "chant:chant flute2:flute chant2:chirimia flute:flute2 slit:slit organum rattle shell", dyn: 0.6, to: 0.54 },
    ],
  ],
  rest: [8, 14],
};
