// 《渔火》：明的沿海与东海、黄海的夜（闽粤外海、舟山、长江口外、渤海）——天黑以后，渔船一条条点起灯，远看像一片落在水上的星。
// 与《闽海长风》《东海的季风》在各自的海上轮着放。第九批 A01（2026-11-11）新写，旋律原创。
// A 羽调式的五声（A C D E G），4/4 拍（每分钟 63 拍），慢、静，句子之间留着气口：
// - 引子：古筝一串上行的刮奏，埙在低处应一声（从下面按上来，落在主音）；
// - A：箫唱主题，一句两小节，长音上慢慢揉开；
// - B：转到 C 宫一侧，二胡拉一段更动情的句子，爬到高音 C 再一级级落下来，琵琶在下面轻轻分解；
// - A′：箫再唱主题，古筝在下面弹“流水”一样的分解音型（一小节八个八分音符，跟着和声走）；另一遍里由埙在低八度先唱一遍；
// - 尾声：古筝一串下行的刮奏收住。
// 不写大小三和弦的进行，只用五声里的和音与空五度；衬底是很轻的持续音与拨奏低音（管弦版换成真的弦乐）。
import type { TrackDef } from "../score";

const MEL = "!bend!A4 c2 d2 | e4 !vib!g4 | a3 g e2 d2 | !vib!e6 z2 | g3 e d2 c2 | d4 !bend!G4 | A2 c2 d2 e2 | !vib!A8";

export const SEA_LANTERNS: TrackDef = {
  id: "sea_lanterns",
  title: { zh: "渔火" },
  qpm: 63,
  meter: [4, 4],
  key: "A minor",
  level: 1.22,
  space: 1.15,
  voices: {
    xiao: { inst: "xiao", gain: 0.56, pan: -0.12, reverb: 0.44 },
    xun: { inst: "xun", gain: 0.54, pan: 0.14, reverb: 0.46 },
    erhu: { inst: "erhu", gain: 0.5, pan: -0.2, reverb: 0.36 },
    gz: { inst: "guzheng", gain: 0.34, pan: 0.26, reverb: 0.36 },
    pp: { inst: "pipa", gain: 0.26, pan: 0.3, reverb: 0.3, pattern: { kind: "arp", low: 57, steps: "1 . 5 8 . 5 8 .", ring: 2 } },
    // 衬底（合成）
    drone: { inst: "drone", gain: 0.16, pan: -0.22, reverb: 0.44, pattern: { kind: "pad", low: 52, high: 69, size: 2 } },
    pz: { inst: "pizz", gain: 0.2, pan: 0.05, reverb: 0.18, pattern: { kind: "arp", low: 33, steps: "1 . . . 5 . . .", ring: 3 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "Am | Am",
      lines: {
        gliss: "A,/2C/2D/2E/2 G/2A/2c/2d/2 e4 | z8",
        call: "z4 !bend!E4 | !vib!A8",
      },
    },
    A: {
      bars: 8,
      chords: "Am | C | D5 | Am | C | G5 | D5*4 Am/E*4 | Am",
      lines: { mel: MEL },
    },
    B: {
      bars: 6,
      chords: "C | Am | D5 | G5 | C | E5",
      lines: {
        bmel: "c2 d2 e3 g | !slide!a4 g2 e2 | d3 e g2 a2 | !vib!g6 e2 | c'3 a g2 e2 | g2 d2 !vib!e4",
      },
    },
    A2: {
      bars: 8,
      chords: "Am | C | D5 | Am | C | G5 | D5*4 Am/E*4 | Am",
      lines: {
        mel: MEL,
        // 古筝的“流水”
        flow: "A,E A c e c A E | C G c e g e c G | D A d e a e d A | A,E A c e c A E | C G c e g e c G | G,D G A d A G D | D A d a E A e a | A,E A c !vib!e4",
      },
    },
    coda: {
      bars: 2,
      chords: "D5 | Am",
      lines: {
        end: "d2 e2 g2 e2 | !vib!A8",
        gliss: "z8 | a/2g/2e/2d/2 c/2A/2G/2E/2 A,4",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "gliss:gz call:xun drone", dyn: 0.5, to: 0.56 },
      { s: "A", play: "mel:xiao drone pz", dyn: 0.6 },
      { s: "B", play: "bmel:erhu pp drone pz", dyn: 0.62, to: 0.66 },
      { s: "A2", play: "mel:xiao flow:gz drone pz", dyn: 0.64, to: 0.6 },
      { s: "coda", play: "end:xiao gliss:gz drone", dyn: 0.54, to: 0.4, rit: 0.82 },
    ],
    [
      { s: "intro", play: "gliss:gz call:xun drone", dyn: 0.5, to: 0.54 },
      { s: "A", play: "mel:xun-12 drone pz", dyn: 0.58 },
      { s: "A2", play: "mel:xiao flow:gz drone pz", dyn: 0.62 },
      { s: "B", play: "bmel:erhu pp drone pz", dyn: 0.64, to: 0.68 },
      { s: "A2", play: "mel:erhu mel:xiao flow:gz pp drone pz", dyn: 0.66, to: 0.6 },
      { s: "coda", play: "end:xiao gliss:gz drone", dyn: 0.54, to: 0.4, rit: 0.82 },
    ],
  ],
  rest: [25, 45],
};
