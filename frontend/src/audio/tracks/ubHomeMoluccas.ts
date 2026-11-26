// 《火山脚下的丁香园》：养成篇·家乡的日常——摩鹿加（凯奇利的特尔纳特：火山坡上的丁香园、苏丹的城、海峡对面的蒂多雷；
// 自创主角里马来人的家也放这一首）。旋律原创。
// 摩鹿加的锣乐与爪哇的甘美兰不同：一排小锣（这里用库林唐排锣，摩鹿加叫“托托布昂”的那一类）叮叮地绕，大锣（阿贡）一低一高地走，
// 平顶锣（巴本迪尔）一直打着拍子，杯形鼓（达巴坎，代替摩鹿加的提法鼓）领着；苏丹的城里还有伊斯兰的框鼓（特尔班）。
// A 小五声（A C D E G），4/4（每分钟 100 拍）：
// - 引子：排锣一个人起句，阿贡与巴本迪尔进来；
// - A：苏灵笛唱主题，排锣在下面一拍两个音地来回绕；再一遍另一排锣在高处与苏灵笛同一条旋律，达巴坎鼓加进来；
// - B：雷巴布（弓弦）唱一段慢一些的，像傍晚从清真寺那边传来的歌，特尔班框鼓轻轻地拍，排锣歇下；
// - A″：全体，尾声排锣收。
// 锣乐没有西洋的和声：只有很轻的空五度持续音（A–E、D–A、G–D、C–G）托底——五声音阶的每个音放在这几个空五度上都不刺耳。
// 衬底（合成的持续音与很轻的拨奏）管弦版换成很轻的弦乐。
import type { TrackDef } from "../score";

/** 阿贡：低的（A）落在第一、三拍，高的（E）在拍后。 */
const AGUNG = Array.from({ length: 8 }, () => "A,,2 z E,, A,,2 E,, z").join(" | ");
/** 排锣的来回：一拍两个音，跟着空五度换位置。 */
const KUL = "A c e c A c e2 | G A c A G A c2 | D E A E D E A2 | G A d A G A d2 | c d g d c d g2 | D E A E D E A2 | G A d A G A d2 | A c e c A2 z2";

export const UB_HOME_MOLUCCAS: TrackDef = {
  id: "ub_home_moluccas",
  title: { zh: "火山脚下的丁香园" },
  qpm: 100,
  meter: [4, 4],
  key: "A minor",
  voices: {
    suling: { inst: "suling", gain: 0.46, pan: -0.08, reverb: 0.36 },
    kul: { inst: "kulintang", gain: 0.3, pan: 0.22, reverb: 0.28 },
    kul2: { inst: "kulintang", gain: 0.36, pan: -0.2, reverb: 0.3 },
    agung: { inst: "agung", gain: 0.4, pan: 0.04, reverb: 0.34 },
    rebab: { inst: "rebab", gain: 0.44, pan: 0.1, reverb: 0.34 },
    babendil: { inst: "perc", gain: 0.2, pan: 0.3, reverb: 0.24, pattern: { kind: "drum", steps: "b.mb.mb.", hits: { b: ["babendil", 0.4], m: ["babendil_mute", 0.28] } } },
    dabakan: { inst: "perc", gain: 0.26, pan: -0.06, reverb: 0.22, pattern: { kind: "drum", steps: "D..dr.D.", hits: { D: ["dabakan", 0.56], d: ["dabakan", 0.36], r: ["dabakan_rim", 0.3] } } },
    terbang: { inst: "perc", gain: 0.24, pan: -0.28, reverb: 0.26, pattern: { kind: "drum", steps: "T.t.Tt.t", hits: { T: ["terbang_dung", 0.5], t: ["terbang_tak", 0.32] } } },
    // 衬底（合成）：很轻的空五度持续音与拨奏
    dem: { inst: "drone", gain: 0.12, pan: -0.2, reverb: 0.44, pattern: { kind: "pad", low: 52, high: 69, size: 2 } },
    pz: { inst: "pizz", gain: 0.16, pan: 0.06, reverb: 0.16, pattern: { kind: "arp", low: 33, steps: "1 . . . 5 . . .", ring: 3 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "A5 | A5",
      lines: { kp: "A c e c A c e2 | G A c A G A c2", ag: "A,,2 z E,, A,,2 E,, z | A,,2 z E,, A,,2 E,, z" },
    },
    A: {
      bars: 8,
      chords: "A5 | A5 | D5 | G5 | C5 | D5 | G5 | A5",
      lines: {
        mel: "e2 d c A2 G2 | A3 c A4 | d2 e d c2 A2 | G6 z2 | c2 d e g2 e2 | d3 e d c A2 | d2 c A G2 E2 | A8",
        kp: KUL,
        ag: AGUNG,
      },
    },
    B: {
      bars: 8,
      chords: "D5 | D5 | A5 | A5 | C5 | G5 | D5 | A5",
      lines: {
        bm: "A3 G A2 c2 | d4 c2 A2 | e3 d c2 A2 | !vib!A6 z2 | G2 A c e2 d2 | d3 c A2 G2 | A2 G E D2 E2 | !vib!A8",
        ag: AGUNG,
      },
    },
    coda: {
      bars: 2,
      chords: "A5 | A5",
      lines: { cd: "e2 d c A2 G2 | A8", kp: "A c e c A c e2 | A8", ag: "A,,2 z E,, A,,2 E,, z | A,,8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "kp:kul ag:agung babendil dem", dyn: 0.56 },
      { s: "A", play: "mel:suling kp:kul ag:agung babendil dem", dyn: 0.6 },
      { s: "A", play: "mel:suling mel:kul2 kp:kul ag:agung babendil dabakan dem pz", dyn: 0.64 },
      { s: "B", play: "bm:rebab ag:agung terbang dem", dyn: 0.6 },
      { s: "A", play: "mel:suling mel:kul2 kp:kul ag:agung babendil dabakan terbang dem pz", dyn: 0.68 },
      { s: "coda", play: "cd:suling kp:kul ag:agung dem", dyn: 0.6, to: 0.44, rit: 0.86 },
    ],
    [
      { s: "intro", play: "kp:kul ag:agung babendil dem", dyn: 0.54 },
      { s: "A", play: "mel:kul2 kp:kul ag:agung babendil dem", dyn: 0.58 },
      { s: "B", play: "bm:suling ag:agung terbang dem", dyn: 0.58 },
      { s: "A", play: "mel:suling mel:kul2 kp:kul ag:agung babendil dabakan dem pz", dyn: 0.64 },
      { s: "B", play: "bm:rebab bm:suling ag:agung terbang dem pz", dyn: 0.62 },
      { s: "A", play: "mel:suling mel:kul2 kp:kul ag:agung babendil dabakan terbang dem pz", dyn: 0.68 },
      { s: "coda", play: "cd:suling kp:kul ag:agung dem", dyn: 0.6, to: 0.44, rit: 0.86 },
    ],
  ],
  rest: [10, 16],
  level: 1.12,
};
