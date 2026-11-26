// 《皮影戏的夜》：马来世界的港口（柔佛、亚齐、万丹、哲帕拉、锦石、望加锡、文莱、特尔纳特……）的第二首——夜里，
// 王城的院子里支起白布、点上油灯演皮影，甘美兰在幕后轻轻地敲一整夜。与《胡椒与肉豆蔻的码头》轮着放；天黑以后进港时先放这一首。
// 第九批 A01（2026-11-11）新写，旋律原创。写成爪哇甘美兰的“软”合奏：五声的斯连德罗（slendro，这里近似成 D E 升F A B），4/4 拍（每分钟 66 拍），很慢——
// - 骨干旋律（balungan）由斯连特姆（低音铜板琴）两拍一个音地敲，八小节一圈，圈尾大锣“翁——”地一声；
// - 根德尔与甘邦（木琴）绕着骨干音不停地转，西特琴在弱拍上拨，肯普尔与克农在各自的位置点一下，肯当鼓只轻轻地带；
// - 第一圈苏灵笛在上面自由地吹，第二圈（高处的一圈）换雷巴布，第三圈两件一起；
// - 引子是雷巴布的一句“布卡”（buka），尾声停在大锣上。
// 不写三和弦，只有空五度；衬底是极轻的持续音（管弦版换成真的中提琴与大提琴）。
import type { TrackDef } from "../score";

const GONG_END = "z8 | z8 | z8 | z8 | z8 | z8 | z8 | z4 D,,,4";

export const PORT_MALAY_NIGHT: TrackDef = {
  id: "port_malay_night",
  title: { zh: "皮影戏的夜" },
  qpm: 66,
  meter: [4, 4],
  key: "D major",
  level: 1.15,
  space: 1.15,
  voices: {
    sul: { inst: "suling", gain: 0.46, pan: -0.12, reverb: 0.42 },
    reb: { inst: "rebab", gain: 0.46, pan: 0.14, reverb: 0.38 },
    slen: { inst: "slenthem", gain: 0.4, pan: 0.02, reverb: 0.4 },
    gender: { inst: "gender", gain: 0.26, pan: -0.28, reverb: 0.38, pattern: { kind: "arp", low: 57, steps: "1 5 8 5 8 5 1 5", ring: 2 } },
    gamb: { inst: "gambang", gain: 0.2, pan: 0.3, reverb: 0.32, pattern: { kind: "arp", grid: 0.5, low: 62, steps: "1 8 5 8 1 8 5 8 5 8 1 8 5 8 1 8" } },
    siter: { inst: "siter", gain: 0.22, pan: 0.2, reverb: 0.32, pattern: { kind: "arp", low: 60, steps: "- 8 - 5 - 8 - 5", ring: 1 } },
    kempul: { inst: "kempul", gain: 0.3, pan: -0.06, reverb: 0.42, pattern: { kind: "arp", low: 38, steps: "- - - - 1 - - -", ring: 4 } },
    kenong: { inst: "kenong", gain: 0.22, pan: 0.1, reverb: 0.4, pattern: { kind: "arp", low: 69, steps: "- - - - - - 1 -", ring: 2 } },
    gong: { inst: "gong_ageng", gain: 0.4, pan: 0, reverb: 0.5 },
    kend: { inst: "perc", gain: 0.2, pan: 0.08, reverb: 0.26, pattern: { kind: "drum", steps: "d...t.k.", hits: { d: ["kendang_dhung", 0.44], t: ["kendang_tak", 0.26], k: ["kendang_ket", 0.2] } } },
    // 衬底（合成）
    drone: { inst: "drone", gain: 0.13, pan: -0.2, reverb: 0.44, pattern: { kind: "pad", low: 50, high: 69, size: 2 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "D5 | D5",
      lines: { buka: "z4 A2 B2 | d2 B2 A2 F2" },
    },
    A: {
      bars: 8,
      chords: "D5 | A5 | A5 | D5 | B5 | E5 | E5 | B5*4 D5*4",
      lines: {
        bal: "D4 B,4 | A,4 F,4 | A,4 B,4 | D4 A,4 | B,4 D4 | E4 F4 | E4 D4 | B,4 D4",
        mel: "f4 e2 d2 | e3 f a4 | b4 a2 f2 | !vib!a6 z2 | b3 a f2 e2 | e4 f2 a2 | b2 a2 f2 e2 | f4 !vib!d4",
        gong: GONG_END,
      },
    },
    B: {
      bars: 8,
      chords: "A5 | D5 | D5 | F#5 | B5 | A5 | E5 | A5*4 D5*4",
      lines: {
        bal: "A,4 B,4 | D4 A,4 | D4 E4 | F4 D4 | B,4 A,4 | A,4 F,4 | E4 F4 | A,4 D4",
        bmel: "e4 f2 a2 | a3 f e2 d2 | d2 e2 f2 a2 | !vib!f6 z2 | b4 a2 f2 | e4 a4 | b2 a2 f2 e2 | e4 !vib!d4",
        gong: GONG_END,
      },
    },
    outro: {
      bars: 2,
      chords: "A5 | D5",
      lines: {
        tag: "e2 f2 e2 d2 | !vib!d8",
        gong: "z8 | D,,,8",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "buka:reb drone", dyn: 0.5, to: 0.56 },
      { s: "A", play: "bal:slen mel:sul gender siter kempul kenong gong:gong kend drone", dyn: 0.6 },
      { s: "B", play: "bal:slen bmel:reb gender gamb siter kempul kenong gong:gong kend drone", dyn: 0.62 },
      { s: "A", play: "bal:slen mel:sul mel:reb gender gamb siter kempul kenong gong:gong kend drone", dyn: 0.64, to: 0.6 },
      { s: "outro", play: "tag:sul gender gong:gong drone", dyn: 0.54, to: 0.4, rit: 0.82 },
    ],
    [
      { s: "intro", play: "buka:reb drone", dyn: 0.5, to: 0.54 },
      { s: "A", play: "bal:slen mel:reb gender siter kempul kenong gong:gong drone", dyn: 0.58 },
      { s: "A", play: "bal:slen mel:sul gender gamb siter kempul kenong gong:gong kend drone", dyn: 0.6 },
      { s: "B", play: "bal:slen bmel:reb gender gamb siter kempul kenong gong:gong kend drone", dyn: 0.62 },
      { s: "A", play: "bal:slen mel:sul mel:reb gender gamb siter kempul kenong gong:gong kend drone", dyn: 0.64, to: 0.6 },
      { s: "outro", play: "tag:sul gender gong:gong drone", dyn: 0.54, to: 0.4, rit: 0.82 },
    ],
  ],
  rest: [10, 18],
};
