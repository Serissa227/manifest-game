// 《阿里卡的银》：安第斯沿岸的港口（阿里卡、钦查、卡亚俄……波托西的银从山上驮下来装船，羊驼、盐与辣椒的市）。
// 地方特色第一阶段重编：安第斯的乐器领奏（复古合成版的衬底用合成的弦乐与拨奏低音）。旋律沿用第三轮的原创旋律。
// A 小调五声（A C D E G），4/4（每分钟 116 拍），瓦伊诺舞的“长 — 短短”：
// - 引子：盖那笛在空处吹一句（音头滑上来、长音揉开），羊蹄壳串一抖一阵，邦博鼓进来；
// - A：盖那笛领奏，恰朗戈快速地“下 · 上下”扫（每拍一个长—短短），邦博鼓“嘭 · 嘭嘭”；
// - A′：排箫——两排管由两个人一人一音地交替吹（ira 与 arka 的轮吹，合起来才是一条旋律），气声重、起音“噗”；
// - B：盖那笛唱，塔尔卡木笛在下方五度平行着走（高原的粗嗓门）；
// - A″：盖那笛与排箫一起，慢下来，邦博鼓与恰朗戈一扫收住。
import type { TrackDef } from "../score";
import { hocket } from "./weave";

const MEL = "e2 e/2d/2c d2 e2 | g2 g/2e/2d e4 | d2 d/2c/2A G2 A2 | A6 z2 | c2 c/2d/2e g2 e2 | d2 c/2A/2G A2 c2 | d2 A2 E4 | A8";

export const PORT_ANDES: TrackDef = {
  id: "port_andes",
  title: { zh: "阿里卡的银", en: "Silver of Arica" },
  qpm: 116,
  meter: [4, 4],
  key: "A minor",
  voices: {
    quena: { inst: "quena", gain: 0.52, pan: -0.12, reverb: 0.34 },
    ira: { inst: "siku", gain: 0.44, pan: -0.22, reverb: 0.32 },
    arka: { inst: "siku", gain: 0.44, pan: 0.22, reverb: 0.32 },
    tarka: { inst: "tarka", gain: 0.3, pan: 0.14, reverb: 0.3 },
    charango: { inst: "charango", gain: 0.2, pan: 0.3, reverb: 0.2, pattern: { kind: "strum", low: 60, high: 81, grid: 0.5, steps: "D . u d D . u d D . u d D . u d" } },
    bombo: {
      inst: "perc",
      gain: 0.34,
      pan: 0.04,
      reverb: 0.24,
      pattern: {
        intro: { kind: "drum", steps: "........................B..bB.bb", hits: { B: ["bombo", 0.7], b: ["bombo", 0.4] } },
        a: { kind: "drum", grid: 0.5, steps: "B.bbB.r.B.bbB.r.", hits: { B: ["bombo", 0.75], b: ["bombo", 0.42], r: ["bombo_rim", 0.5] } },
        coda: { kind: "drum", steps: "B.B.B...B.......", hits: { B: ["bombo", 0.85] } },
      },
    },
    chajchas: { inst: "perc", gain: 0.26, pan: -0.3, reverb: 0.24, pattern: { kind: "drum", steps: "c.......c...c.c.", hits: { c: ["chajchas", 0.55] } } },
    // 衬底（合成）：弦乐的长音、拨奏的低音
    strings: { inst: "strings", gain: 0.2, pan: -0.22, reverb: 0.4, pattern: { kind: "pad", low: 55, high: 71, size: 3 } },
    bass: { inst: "pizz", gain: 0.3, pan: 0.05, reverb: 0.15, pattern: { kind: "arp", low: 33, steps: "1 . 5, . 1 . 5, .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "Am | Am | G | Am",
      lines: { call: "!bend!e6 {f}e d | !vib!c4 A4 | !bend!G4 A2 c2 | !vib!A8" },
    },
    A: {
      bars: 8,
      chords: "Am | C | G | Am | C | G | Dm E | Am",
      lines: { mel: MEL, ira: hocket(MEL, 0), arka: hocket(MEL, 1) },
    },
    B: {
      bars: 8,
      chords: "C | G | Am | Em | F | C | Dm E | Am",
      lines: { bmel: "e3 g e2 c2 | d3 e d2 G2 | c3 d c2 A2 | E6 z2 | c3 d c2 A2 | G3 A c2 e2 | d2 c2 E4 | A8" },
    },
    coda: { bars: 2, chords: "Am | Am", lines: { end: "!vib!A8 | z8" } },
  },
  forms: [
    [
      { s: "intro", play: "call:quena chajchas bombo.intro strings", dyn: 0.62 },
      { s: "A", play: "mel:quena charango bombo.a chajchas bass", dyn: 0.66 },
      { s: "A", play: "ira:ira arka:arka charango bombo.a chajchas strings bass", dyn: 0.68 },
      { s: "B", play: "bmel:quena bmel:tarka-7 charango bombo.a strings bass", dyn: 0.66 },
      { s: "A", play: "mel:quena ira:ira arka:arka charango bombo.a chajchas strings bass", dyn: 0.7, rit: 0.92 },
      { s: "coda", play: "end:quena bombo.coda strings", dyn: 0.68 },
    ],
    [
      { s: "A", play: "ira:ira arka:arka charango bombo.a chajchas bass", dyn: 0.64 },
      { s: "B", play: "bmel:quena charango bombo.a strings bass", dyn: 0.66 },
      { s: "A", play: "mel:quena ira:ira arka:arka charango bombo.a chajchas strings bass", dyn: 0.7, rit: 0.92 },
      { s: "coda", play: "end:quena bombo.coda strings", dyn: 0.68 },
    ],
  ],
  rest: [10, 18],
  level: 1.18,
};
