// 《钦查的筏》：安第斯的太平洋沿岸（秘鲁寒流、钦查、阿里卡；钦查的商人驾着轻木筏沿岸南来北往，比西班牙人的帆早了几百年）。
// E 小调五声（E G A B D；B 七和弦上带升 F 与升 D），4/4 拍（每分钟 100 拍），用瓦伊诺舞的节奏：“长 — 短短”（八分音符接两个十六分）。
// 地方特色第二阶段·美洲重编（旋律、和声与曲式不变；以前是木笛、鼻笛、四弦小吉他与群岛的大鼓“模仿”安第斯的乐器，现在由安第斯的乐器领奏）：
// - 开头普图图海螺号（印加的驿卒吹它）一声长音，盖那笛吹起全作的起帆动机（B → E → B）；
// - A 段盖那笛领奏；再来时排箫——两排管由两个人一人一音地交替吹（ira 与 arka 的轮吹，合起来才是一条旋律），气声重、起音“噗”；
//   最后一遍盖那笛与轮吹的排箫一起；
// - B 段转到 G 大调一侧，旋律拉长（像慢的雅拉维），经过 B 七和弦回到 E 小调；第二遍是两套大小不同的排箫平行四度——
//   每一套照旧是 ira 与 arka 两个人轮吹（大的一套 ira_low / arka_low 低四度），排箫队里的四度、五度就是这样来的：几套管各自轮吹，叠在一起；
// - 恰朗戈“下 · 上 下”地扫，万卡拉大鼓（鼓面弦“嗞”地嗡）在一拍与三拍前推一下，廷亚小鼓点着反拍，羊蹄壳串一抖一阵；
// - 衬底（合成）只有拨奏的低音与很轻的弦乐长音。
import type { TrackDef } from "../score";
import { hocket } from "./weave";

const MEL = "B2 B A/2G/2 A2 B2 | d2 d B/2A/2 G4 | A2 A G/2E/2 D4 | E2 G2 E4 | e2 e d/2B/2 d2 e2 | e2 d B/2A/2 A4 | B2 B A/2G/2 F4 | E8";
const BMEL = "d4 B2 d2 | A4 d2 A2 | B4 G2 E2 | F4 D4 | G4 E2 G2 | B4 d2 B2 | A2 c2 B2 ^D2 | E8";

export const SEA_ANDES: TrackDef = {
  id: "sea_andes",
  title: { zh: "钦查的筏", en: "The Rafts of Chincha" },
  qpm: 100,
  meter: [4, 4],
  key: "E minor",
  voices: {
    quena: { inst: "quena", gain: 0.52, pan: -0.12, reverb: 0.36 },
    ira: { inst: "siku", gain: 0.44, pan: -0.22, reverb: 0.34 },
    arka: { inst: "siku", gain: 0.44, pan: 0.22, reverb: 0.34 },
    // 大一号的一套排箫（低四度），同样两个人轮吹
    ira_low: { inst: "siku", gain: 0.36, pan: -0.34, reverb: 0.36 },
    arka_low: { inst: "siku", gain: 0.36, pan: 0.34, reverb: 0.36 },
    pututu: { inst: "pututu", gain: 0.3, pan: 0.1, reverb: 0.5 },
    charango: { inst: "charango", gain: 0.2, pan: 0.3, reverb: 0.22, pattern: { kind: "strum", low: 52, high: 71, steps: "D . u d D . u d" } },
    wankara: { inst: "perc", gain: 0.3, pan: 0.06, reverb: 0.26, pattern: { kind: "drum", steps: "W..wW.w.", hits: { W: ["wankara", 0.62], w: ["wankara", 0.36] } } },
    tinya: { inst: "perc", gain: 0.2, pan: -0.24, reverb: 0.24, pattern: { kind: "drum", steps: ".t.t.t.T", hits: { t: ["tinya_soft", 0.4], T: ["tinya", 0.5] } } },
    chajchas: { inst: "perc", gain: 0.22, pan: -0.32, reverb: 0.24, pattern: { kind: "drum", steps: "c.......c...c.c.", hits: { c: ["chajchas", 0.5] } } },
    // 衬底（合成）：拨奏的低音、很轻的弦乐长音
    bass: { inst: "pizz", gain: 0.21, pan: 0.05, reverb: 0.15, pattern: { kind: "arp", low: 36, steps: "1 . 5, . 1 . 5, .", ring: 2 } },
    strings: { inst: "strings", gain: 0.15, pan: -0.22, reverb: 0.42, pattern: { kind: "pad", low: 55, high: 71, size: 3 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "Em | Em",
      lines: {
        // 普图图一声长音；盖那笛的起帆动机（B → E → B）
        call: "!bend!E,6 z2 | z8",
        motif: "z6 B3/2 e/2 | b8",
      },
    },
    A: {
      bars: 8,
      chords: "Em | G | D | Em | Em | Am | B7 | Em",
      lines: {
        // 瓦伊诺：长 — 短短
        mel: MEL,
        ira: hocket(MEL, 0),
        arka: hocket(MEL, 1),
      },
    },
    B: {
      bars: 8,
      chords: "G | D | Em | Bm | C | G | Am B7 | Em",
      lines: {
        bmel: BMEL,
        // 排箫的轮吹（第二遍）
        ira: hocket(BMEL, 0),
        arka: hocket(BMEL, 1),
      },
    },
    outro: { bars: 2, chords: "Am | Em", lines: { tag: "A2 A G/2E/2 D4 | E8" } },
  },
  forms: [
    [
      { s: "intro", play: "call:pututu motif:quena charango chajchas", dyn: 0.54, to: 0.62 },
      { s: "A", play: "mel:quena charango bass wankara tinya", dyn: 0.64 },
      { s: "A", play: "ira:ira arka:arka charango bass wankara tinya chajchas", dyn: 0.68 },
      { s: "B", play: "bmel:quena strings charango bass wankara", dyn: 0.68, to: 0.72 },
      { s: "A", play: "mel:quena ira:ira arka:arka charango strings bass wankara tinya chajchas", dyn: 0.72 },
      { s: "outro", play: "tag:quena charango strings", dyn: 0.6, to: 0.4, rit: 0.85 },
    ],
    [
      { s: "intro", play: "call:pututu motif:quena charango", dyn: 0.52, to: 0.6 },
      { s: "A", play: "ira:ira arka:arka charango bass wankara tinya", dyn: 0.64 },
      { s: "B", play: "bmel:quena strings bass", dyn: 0.66 },
      { s: "B", play: "ira:ira arka:arka ira:ira_low-5 arka:arka_low-5 strings charango bass wankara chajchas", dyn: 0.7, to: 0.72 },
      { s: "A", play: "mel:quena ira:ira arka:arka charango strings bass wankara tinya chajchas", dyn: 0.72 },
      { s: "outro", play: "tag:quena charango strings", dyn: 0.58, to: 0.38, rit: 0.85 },
    ],
  ],
  rest: [25, 45],
  level: 1.38,
};
