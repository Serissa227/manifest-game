// 《台风》：东亚的海上遇到的暴风雨（明的沿海、东海与黄海、日本的海、菲律宾一带）——夏秋之交从南边卷上来的大风，
// 这几片海上的风暴放这一首（与《怒涛》轮着放），别处照旧是《怒涛》《烈风》。第九批 A01（2026-11-11）新写，旋律原创。
// A 羽调式的五声（A C D E G），B 段借降 B（降二级）压一下；4/4 拍（每分钟 132 拍）：
// - 引子：大锣一声，堂鼓与太鼓由疏到密；
// - A：琵琶不停地扫着十六分音符的固定音型（根音 – 五度 – 八度：战曲里“扫拂”的手法），唢呐在上面吹一条急的旋律；
// - B：大笛在低处吹一段沉的句子（风眼外面那一圈），能管在句尾尖啸一声（从下面滑上去再落下来）；
// - 中间一段只剩鼓与锣；板鼓一直碎着，铙钹在弱拍上，太鼓压着重拍。
// 不写三和弦，只有空五度；衬底是很轻的弦乐长音（管弦版是小提琴组的颤弓与低音提琴）。
import type { TrackDef } from "../score";

const GONG = "G,8 | z8 | z8 | z8 | G,8 | z8 | z8 | z8";

export const STORM_TYPHOON: TrackDef = {
  id: "storm_typhoon",
  title: { zh: "台风" },
  qpm: 132,
  meter: [4, 4],
  key: "A minor",
  level: 1.07,
  hall: true,
  voices: {
    suona: { inst: "suona", gain: 0.46, pan: -0.14, reverb: 0.36 },
    dadi: { inst: "dadi", gain: 0.56, pan: 0.12, reverb: 0.38 },
    noh: { inst: "nohkan", gain: 0.3, pan: -0.3, reverb: 0.5 },
    pipa: { inst: "pipa", gain: 0.3, pan: 0.28, reverb: 0.26, pattern: { kind: "arp", grid: 0.5, low: 57, steps: "1 1 5 1 8 1 5 1" } },
    daluo: { inst: "daluo", gain: 0.34, pan: 0.02, reverb: 0.44 },
    tg: { inst: "perc", gain: 0.36, pan: -0.08, reverb: 0.3, pattern: { kind: "drum", steps: "T..tT.t.T..tT.tt", hits: { T: ["tanggu", 0.7], t: ["tanggu", 0.4] } } },
    tk: { inst: "perc", gain: 0.3, pan: 0.1, reverb: 0.36, pattern: { kind: "drum", steps: "D...d...D..dD.k.", hits: { D: ["taiko_don", 0.72], d: ["taiko_don", 0.4], k: ["taiko_ka", 0.46] } } },
    bo: { inst: "perc", gain: 0.2, pan: 0.24, reverb: 0.34, pattern: { kind: "drum", steps: "....b.......b.B.", hits: { b: ["bo_mute", 0.4], B: ["bo", 0.5] } } },
    bangu: { inst: "perc", gain: 0.18, pan: -0.22, reverb: 0.24, pattern: { kind: "drum", grid: 0.5, steps: "x.xxx.xxx.xxx.xx", hits: { x: ["bangu", 0.34] } } },
    // 衬底（合成）
    pad: { inst: "strings", gain: 0.24, pan: -0.1, reverb: 0.42, pattern: { kind: "pad", low: 57, high: 76, size: 2 } },
    low: { inst: "strings", gain: 0.26, pan: 0.2, reverb: 0.34, pattern: { kind: "pad", low: 33, high: 45, size: 1 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "A5 | A5",
      lines: { gong: "G,8 | z8" },
    },
    A: {
      bars: 8,
      chords: "A5 | A5 | D5 | E5 | A5 | G5 | D5*4 E5*4 | A5",
      lines: {
        mel: "e4 a3 g | e2 d2 c2 A2 | d4 g3 e | e6 B2 | a4 c'3 a | g2 e2 d2 e2 | d2 e2 g2 b2 | a8",
        gong: GONG,
      },
    },
    B: {
      bars: 8,
      chords: "D5 | D5 | A5 | A5 | Bb5 | A5 | E5 | E5",
      lines: {
        bmel: "D4 A3 G | A2 G2 F2 D2 | E4 A3 c | B2 A2 E4 | _B4 d3 f | e2 d2 c2 A2 | B4 e3 d | e8",
        // 能管的尖啸
        shriek: "z8 | z8 | z8 | !bend!a'4 !fall!g'4 | z8 | z8 | z8 | !bend!a'6 !fall!e'2",
        gong: GONG,
      },
    },
    C: {
      bars: 4,
      chords: "A5 | A5 | E5 | E5",
      lines: { gong: "G,8 | z8 | G,8 | z8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "gong:daluo tg tk pad", dyn: 0.62, to: 0.72 },
      { s: "A", play: "pipa gong:daluo tg tk bangu pad low", dyn: 0.72 },
      { s: "A", play: "mel:suona pipa gong:daluo tg tk bo bangu pad low", dyn: 0.76 },
      { s: "B", play: "bmel:dadi shriek:noh pipa gong:daluo tg tk bo bangu pad low", dyn: 0.78 },
      { s: "A", play: "mel:suona mel:dadi-12 pipa gong:daluo tg tk bo bangu pad low", dyn: 0.82 },
      { s: "C", play: "gong:daluo tg tk bo bangu low", dyn: 0.76, to: 0.66 },
    ],
    [
      { s: "intro", play: "gong:daluo tg tk", dyn: 0.62, to: 0.7 },
      { s: "A", play: "mel:suona pipa gong:daluo tg tk bangu pad low", dyn: 0.74 },
      { s: "B", play: "bmel:dadi pipa gong:daluo tg tk bo bangu pad low", dyn: 0.76 },
      { s: "B", play: "bmel:dadi shriek:noh pipa gong:daluo tg tk bo bangu pad low", dyn: 0.8 },
      { s: "A", play: "mel:suona mel:dadi-12 pipa gong:daluo tg tk bo bangu pad low", dyn: 0.82 },
      { s: "C", play: "gong:daluo tg tk bo bangu low", dyn: 0.76, to: 0.66 },
    ],
  ],
  rest: [3, 6],
};
