// 《港町的夕凪》：日本的港口（堺、博多、平户、长崎、鹿儿岛、土佐的浦……）的第二首——傍晚海风停下来的那一阵（夕凪），
// 町里的人家点了灯，远处有人在弹筝。与《町家与潮风》轮着放；天黑以后进港时先放这一首。
// 第九批 A01（2026-11-11）新写，旋律原创。A 上的都节音阶（A 降B D E F：小二度与大三度交替的阴音阶），4/4 拍（每分钟 72 拍），慢、留白多（“间”）：
// - 引子：筝一串上行的刮奏，拍子木一声；
// - A：筝弹主题，一句两小节，句尾按着弦揉开；
// - B：尺八接过去吹一段长的句子（从下面按上来、揉开、落下去），小鼓隔很久“噗”一声；
// - A′：筝再弹主题，尺八跟着吹同一条旋律（各走各的装饰），三味线在低处一下一下地点着根音与五度。
// 不写三和弦，只有空五度；衬底是很轻的持续音与低处的弦乐（管弦版换成真的弦乐）。
import type { TrackDef } from "../score";

const MEL = "A4 B2 A2 | E2 F2 A4 | d4 B2 A2 | e4 d2 B2 | A2 B2 d4 | f4 e2 d2 | e2 d2 B2 A2 | F2 E2 !vib!A4";

export const PORT_JAPAN_EVE: TrackDef = {
  id: "port_japan_eve",
  title: { zh: "港町的夕凪" },
  qpm: 72,
  meter: [4, 4],
  key: "A phrygian",
  level: 1.64,
  space: 1.1,
  voices: {
    koto: { inst: "koto", gain: 0.5, pan: 0.2, reverb: 0.4 },
    shaku: { inst: "shakuhachi", gain: 0.54, pan: -0.14, reverb: 0.44 },
    shami: { inst: "shamisen", gain: 0.3, pan: 0.3, reverb: 0.3 },
    hyo: { inst: "perc", gain: 0.22, pan: -0.24, reverb: 0.4, pattern: { kind: "drum", steps: "h" + ".".repeat(31), hits: { h: ["hyoshigi", 0.6] } } },
    tsu: { inst: "perc", gain: 0.26, pan: 0.12, reverb: 0.44, pattern: { kind: "drum", steps: "P...............t...............", hits: { P: ["tsuzumi_pon", 0.6], t: ["tsuzumi_ta", 0.4] } } },
    // 衬底（合成）
    pad: { inst: "drone", gain: 0.17, pan: -0.24, reverb: 0.44, pattern: { kind: "pad", low: 57, high: 74, size: 2 } },
    low: { inst: "strings", gain: 0.24, pan: 0.06, reverb: 0.36, pattern: { kind: "pad", low: 33, high: 45, size: 1 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "A5 | A5",
      lines: { gliss: "A/2B/2d/2e/2 f/2a/2b/2d'/2 e'4 | z8" },
    },
    A: {
      bars: 8,
      chords: "A5 | A5 | D5 | E5 | A5 | D5 | E5 | D5*4 A5*4",
      lines: { mel: MEL },
    },
    B: {
      bars: 6,
      chords: "D5 | D5 | A5 | A5 | E5 | E5",
      lines: {
        bmel: "!bend!d6 e2 | f4 e2 d2 | !vib!A6 z2 | A2 B2 F2 E2 | !bend!E6 F2 | !vib!E8",
      },
    },
    A2: {
      bars: 8,
      chords: "A5 | A5 | D5 | E5 | A5 | D5 | E5 | D5*4 A5*4",
      lines: {
        mel: MEL,
        // 尺八：同一条旋律，从下面按上来、揉开、句尾落下
        smel: "!bend!A4 B2 A2 | E2 F2 !vib!A4 | !bend!d4 B2 A2 | !vib!e4 d2 B2 | A2 B2 !bend!d4 | !vib!f4 e2 d2 | e2 d2 B2 A2 | F2 E2 !vib!A4",
        // 三味线在低处点着根音与五度
        sh: "A,2 A,2 E2 A,2 | A,2 E2 A,2 E2 | D2 D2 A,2 D2 | E2 E2 A,2 E2 | A,2 A,2 E2 A,2 | D2 A,2 D2 D2 | E2 A,2 E2 E2 | A,2 E2 A,4",
      },
    },
    outro: {
      bars: 2,
      chords: "E5 | A5",
      lines: { tag: "e2 d2 B2 A2 | !vib!A8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "gliss:koto pad hyo", dyn: 0.5, to: 0.56 },
      { s: "A", play: "mel:koto pad low", dyn: 0.6 },
      { s: "B", play: "bmel:shaku pad low tsu", dyn: 0.6 },
      { s: "A2", play: "mel:koto smel:shaku sh:shami pad low hyo", dyn: 0.64, to: 0.6 },
      { s: "outro", play: "tag:koto pad low", dyn: 0.54, to: 0.4, rit: 0.84 },
    ],
    [
      { s: "intro", play: "gliss:koto pad hyo", dyn: 0.5, to: 0.54 },
      { s: "A", play: "mel:koto low", dyn: 0.58 },
      { s: "A2", play: "mel:koto sh:shami pad low", dyn: 0.6 },
      { s: "B", play: "bmel:shaku pad low tsu", dyn: 0.6 },
      { s: "A2", play: "mel:koto smel:shaku sh:shami pad low hyo", dyn: 0.64, to: 0.6 },
      { s: "outro", play: "tag:koto pad low", dyn: 0.54, to: 0.4, rit: 0.84 },
    ],
  ],
  rest: [10, 18],
};
