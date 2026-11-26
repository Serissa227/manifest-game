// 《爱资哈尔的长廊》：学院的短主题·开罗，爱资哈尔的“杰巴尔提”住宿区（巴拉卡）。
// C 上的拉斯特木卡姆（E 与 B 都降四分之一音：拉斯特的“中立”的三度与七度），慢 4/4（每分钟 72 拍，一遍半分钟多），平静的步子：
// 开头卡农琴一串上行，然后卡农琴唱一条稳稳的旋律，乌德琴低八度跟着；鼓是慢的“咚 · 咚 · 嗒 · 嗒 ·”，像走在长廊的石板上。
// 地方特色第二阶段重编（旋律与段落不变）：卡农琴、乌德琴、奈伊笛换成地方乐器的新版（kanun、ud、nay），第二遍加上竖拉提琴（卡曼恰，埃及的“卡曼贾”）
// 与奈伊笛异音齐奏——开罗“塔赫特”小乐队的样子；鼓换成达布卡与里克鼓（铜钹轻轻地“卡”）。
// 和声只用空五度的持续音（C–G，四级与五级处换 F–C、G–D），不写西洋的三和弦。
import type { TrackDef } from "../score";

export const AC_AZHAR: TrackDef = {
  id: "ac_azhar",
  title: { zh: "爱资哈尔的长廊", en: "The Arcades of al-Azhar" },
  qpm: 72,
  meter: [4, 4],
  key: "C major",
  level: 1.07,
  voices: {
    kanun: { inst: "kanun", gain: 0.52, pan: 0.16, reverb: 0.34 },
    ud: { inst: "ud", gain: 0.64, pan: -0.14, reverb: 0.3 },
    nay: { inst: "nay", gain: 0.52, pan: -0.06, reverb: 0.4 },
    kamancheh: { inst: "kamancheh", gain: 0.28, pan: 0.22, reverb: 0.36 },
    darb: { inst: "perc", gain: 0.24, pan: 0.1, reverb: 0.24, pattern: { kind: "drum", steps: "D.D.T.T.D.D.T.Tk", hits: { D: ["darb_doum", 0.6], T: ["darb_tek", 0.4], k: ["darb_ka", 0.26] } } },
    riq: { inst: "perc", gain: 0.24, pan: -0.3, reverb: 0.26, pattern: { kind: "drum", steps: "...k...k...k..kk", hits: { k: ["riq_ka", 0.3] } } },
    // 衬底（合成）：C–G 的持续音、拨奏的低音落在“咚”上
    drone: { inst: "drone", gain: 0.3, reverb: 0.34, pattern: { kind: "drone", notes: [36, 43] } },
    bass: { inst: "pizz", gain: 0.2, pan: 0.06, reverb: 0.16, pattern: { kind: "arp", low: 36, steps: "1 . 1 . . . . .", ring: 2 } },
  },
  sections: {
    intro: { bars: 2, chords: "C5 | C5", lines: { gliss: "C/2_/E/2G/2c/2 z6 | z8" } },
    A: {
      bars: 8,
      // 只用空五度
      chords: "C5 | F5 | C5 | G5 | C5 | F5 | G5 | C5",
      lines: { mel: "G2 F2 _/E2 D2 | F3 G A2 c2 | c3 _/B A2 G2 | G6 z2 | c2 d2 _/e2 d2 | c3 _/B A2 F2 | G2 A2 _/B2 A2 | G2 _/E2 D2 C2" },
    },
  },
  forms: [
    [
      { s: "intro", play: "gliss:kanun drone", dyn: 0.54 },
      { s: "A", play: "mel:kanun mel:ud-12 drone bass darb riq", dyn: 0.62 },
    ],
    [
      { s: "intro", play: "gliss:kanun drone", dyn: 0.52 },
      { s: "A", play: "mel:nay mel:kamancheh mel:kanun-12 drone bass darb riq", dyn: 0.62 },
    ],
  ],
  rest: [8, 14],
};
