// 《航路的长诗》：学院的短主题·领航世家的“船上学堂”（纳吉玛：背押韵的航路长诗、用牵星板量北极星；宰比德的经学院也是这个味道）。
// D 上的巴亚提（E 降四分之一音的木卡姆），4/4 的马克苏姆节奏（咚 嗒 · 嗒 咚 · 嗒 ·），每分钟 92 拍，一遍半分钟上下：
// 开头乌德琴在持续音上随手弹两小节（像塔克西姆），然后一条像背诵长诗的旋律——一句一句、押着韵地往前走；卡农琴在高处弹空五度与八度的分解音。
// 地方特色第二阶段重编（旋律与段落不变）：乌德琴、奈伊笛、卡农琴换成地方乐器的新版（ud、nay、kanun），
// 鼓换成达布卡（马克苏姆）与里克鼓的铜钹；第二遍是红海的甲板：西姆西米亚琴（红海水手的竖琴）扫着弦与奈伊笛、低八度的乌德琴异音齐奏（卡农琴歇下），
// 水手们轻轻拍手（空心掌，海湾与红海的歌舞里那样）。
// 和声不写西洋的三和弦：底下只有 D–A 的持续音，卡农琴的分解音只用根音、五度与八度（跟着原来的根音走：D、C、G、F）。
import type { TrackDef } from "../score";

export const AC_SHIP: TrackDef = {
  id: "ac_ship",
  title: { zh: "航路的长诗", en: "Verses of the Sea Roads" },
  qpm: 92,
  meter: [4, 4],
  key: "D bayati",
  level: 1.2,
  voices: {
    ud: { inst: "ud", gain: 0.66, pan: -0.14, reverb: 0.28 },
    nay: { inst: "nay", gain: 0.56, pan: 0.18, reverb: 0.38 },
    simsimiyya: { inst: "simsimiyya", gain: 0.44, pan: 0.3, reverb: 0.28 },
    kanun: { inst: "kanun", gain: 0.2, pan: 0.32, reverb: 0.32, pattern: { kind: "arp", low: 55, steps: "1 5 8 5 12 8 5 8", ring: 2 } },
    darb: { inst: "perc", gain: 0.24, pan: 0.1, reverb: 0.2, pattern: { kind: "drum", steps: "DT.TD.T.DT.TD.kT", hits: { D: ["darb_doum", 0.66], T: ["darb_tek", 0.42], k: ["darb_ka", 0.28] } } },
    riq: { inst: "perc", gain: 0.26, pan: -0.3, reverb: 0.2, pattern: { kind: "drum", steps: "..k...k...k..kk.", hits: { k: ["riq_ka", 0.32] } } },
    claps: { inst: "perc", gain: 0.16, pan: 0.3, reverb: 0.3, pattern: { kind: "drum", steps: "..L...L...L...L.", hits: { L: ["tasfiq_low", 0.4] } } },
    // 衬底（合成）：D–A 的持续音、拨奏的低音落在马克苏姆的两个“咚”上
    drone: { inst: "drone", gain: 0.32, reverb: 0.3, pattern: { kind: "drone", notes: [38, 45] } },
    bass: { inst: "pizz", gain: 0.2, pan: 0.06, reverb: 0.16, pattern: { kind: "arp", low: 36, steps: "1 . . . 1 . . .", ring: 2 } },
  },
  sections: {
    intro: { bars: 2, chords: "D5 | D5", lines: { taqsim: "D2 E F G2 A2 | B A G F E2 D2" } },
    A: {
      bars: 8,
      chords: "D5 | D5 | C5 | D5 | G5 | F5 | C5 | D5",
      lines: { mel: "D2 E F G2 F E | F3 E D4 | G2 G A B2 A G | A6 z2 | B3 A G2 F2 | A3 G F2 E2 | G2 F2 E2 F2 | D8" },
    },
    tag: { bars: 2, chords: "G5 | D5", lines: { tag: "B3 A G2 F2 | E2 D6" } },
  },
  forms: [
    [
      { s: "intro", play: "taqsim:ud drone", dyn: 0.56 },
      { s: "A", play: "mel:ud kanun drone bass darb riq", dyn: 0.64 },
    ],
    [
      { s: "A", play: "mel:simsimiyya mel:nay mel:ud-12 drone bass darb riq claps", dyn: 0.64 },
      { s: "tag", play: "tag:nay drone", dyn: 0.56, to: 0.44, rit: 0.85 },
    ],
  ],
  rest: [8, 14],
};
