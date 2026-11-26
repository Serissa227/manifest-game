// 《茶楼丝竹》：明的港口与城市（月港、广州、宁波、福州、南京……）的第二首——码头边的茶楼上，几个人各拿一件丝竹，
// 你一句我一句地合一支曲子，谁也不抢谁。与《月港的市声》轮着放。第九批 A01（2026-11-11）新写，旋律原创。
// 写法取自江南丝竹的合奏：同一条旋律，笛子吹“繁”的（加花），胡琴拉“简”的，两条叠在一起，琵琶与扬琴各弹各的分解，笙托着长音，拍板点着板眼。
// G 宫的五声（G A B D E），4/4 拍（每分钟 92 拍）：
// - 引子：扬琴敲几个音，在长音上滚开；
// - A：曲笛吹主题的“简”版；A′：曲笛吹加花的“繁”版，二胡同时拉“简”版，古筝跟着；
// - B：转到 E 羽一侧，二胡独自拉一段更柔的句子（从下面滑上去、长音上揉开）；
// - 最后一遍 A′ 全体，尾声落在宫音上。
// 衬底只有拨奏低音与很轻的弦乐长音（管弦版换成真的弦乐）。
import type { TrackDef } from "../score";

const SIMPLE = "d2 e g a2 g2 | e2 g e d2 B2 | e2 d e g2 e2 | d4 A2 B2 | d2 g a b2 a2 | g2 e g a2 g e | d2 e d B2 A2 | B2 A2 G4";

export const PORT_MING_TEA: TrackDef = {
  id: "port_ming_tea",
  title: { zh: "茶楼丝竹" },
  qpm: 92,
  meter: [4, 4],
  key: "G major",
  level: 1.2,
  voices: {
    qudi: { inst: "qudi", gain: 0.5, pan: -0.14, reverb: 0.36 },
    erhu: { inst: "erhu", gain: 0.5, pan: 0.12, reverb: 0.34 },
    gz: { inst: "guzheng", gain: 0.36, pan: 0.28, reverb: 0.32 },
    yq: { inst: "yangqin", gain: 0.34, pan: -0.28, reverb: 0.3 },
    pp: { inst: "pipa", gain: 0.28, pan: 0.2, reverb: 0.28, pattern: { kind: "arp", low: 55, steps: "1 5 8 5 10 5 8 5", ring: 1 } },
    sheng: { inst: "sheng", gain: 0.16, pan: -0.06, reverb: 0.36, pattern: { kind: "pad", low: 62, high: 76, size: 2 } },
    ban: { inst: "perc", gain: 0.3, pan: 0.04, reverb: 0.2, pattern: { kind: "drum", steps: "p...b.b.", hits: { p: ["paiban", 0.5], b: ["bangu", 0.26] } } },
    // 衬底（合成）
    pad: { inst: "strings", gain: 0.1, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 55, high: 71, size: 2 } },
    pz: { inst: "pizz", gain: 0.2, pan: 0.05, reverb: 0.16, pattern: { kind: "arp", low: 31, steps: "1 . . . 5 . . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "G | D5",
      lines: { open: "D2 G2 d2 g2 | !trem!a8" },
    },
    A: {
      bars: 8,
      chords: "G | G | Em | D5 | G | Em | D5 | G",
      lines: { mel: SIMPLE },
    },
    A2: {
      bars: 8,
      chords: "G | G | Em | D5 | G | Em | D5 | G",
      lines: {
        // “简”的一条
        mel: SIMPLE,
        // “繁”的一条：加花
        hua: "d e g a b a g e | e g e d B d e d | e d e g a g e d | d2 e d A2 B2 | d e g a b d' b a | g a g e g a g e | d e d B A B d B | A B A G G4",
      },
    },
    B: {
      bars: 8,
      chords: "Em | Em | A5 | Em | G | D5 | Em | D5",
      lines: {
        bmel: "e4 g2 a2 | !slide!b4 a2 g2 | a3 g e2 d2 | !vib!e6 z2 | d2 e2 g2 b2 | a4 !vib!d4 | e2 g2 e2 d2 | B2 A2 !vib!d4",
      },
    },
    outro: {
      bars: 2,
      chords: "D5 | G",
      lines: { tag: "d2 e d B2 A2 | G8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "open:yq sheng", dyn: 0.52, to: 0.58 },
      { s: "A", play: "mel:qudi pp sheng ban pz", dyn: 0.62 },
      { s: "A2", play: "hua:qudi mel:erhu mel:gz pp sheng ban pz", dyn: 0.66 },
      { s: "B", play: "bmel:erhu pp sheng pad pz", dyn: 0.62, to: 0.66 },
      { s: "A2", play: "hua:qudi hua:yq mel:erhu mel:gz pp sheng ban pad pz", dyn: 0.7, to: 0.66 },
      { s: "outro", play: "tag:qudi tag:gz sheng pad", dyn: 0.58, to: 0.44, rit: 0.84 },
    ],
    [
      { s: "intro", play: "open:yq sheng", dyn: 0.52, to: 0.56 },
      { s: "A", play: "mel:erhu mel:gz pp sheng ban pz", dyn: 0.6 },
      { s: "B", play: "bmel:erhu pp sheng pad pz", dyn: 0.62 },
      { s: "A2", play: "hua:qudi mel:erhu pp sheng ban pz", dyn: 0.66 },
      { s: "B", play: "bmel:qudi bmel:erhu pp sheng pad pz", dyn: 0.66 },
      { s: "A2", play: "hua:qudi hua:yq mel:erhu mel:gz pp sheng ban pad pz", dyn: 0.7, to: 0.66 },
      { s: "outro", play: "tag:qudi tag:gz sheng pad", dyn: 0.58, to: 0.44, rit: 0.84 },
    ],
  ],
  rest: [10, 18],
};
