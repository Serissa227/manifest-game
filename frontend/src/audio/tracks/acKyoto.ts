// 《宫中的筝》：学院的短主题·京都（一条澪：一条本家、宫中女房的见习与宝镜寺）。
// 地方特色第二阶段重编（东亚宫廷）：一段雅乐的管弦（kangen），地方乐器领奏、旋律原创（不仿任何现成的乐曲）。
// E 上的平调（E 升F G A B 升C D，骨干是 E 升F A B 升C 的律音阶），慢 4/4（每分钟 60 拍），四小节一个节拍周期（拍子）：
// - 音头（ondo）：龙笛一个人吹起一句，羯鼓的片来（越打越快的一串）把合奏引进来；
// - A、B（各四小节）：筚篥唱骨干旋律（音与音之间用嘴唇推出来的塩梅，!bend!），龙笛在高八度上缠绕（同一条旋律的异音），
//   笙奏合竹（五六个音的音簇，跟着旋律音一个个地换），乐琵琶每小节开头从最低的弦扫上去、停在旋律音上，乐筝按“閑掻”一拍一组地拨，
//   羯鼓每小节一声“正”、后半小节一串片来，钲鼓在第三拍“カチ”，钓太鼓在周期末尾“图—咚”（轻的左手、重的右手）；
// - 第二遍的 B 是“残乐”：管与笙都停下，筚篥只剩几个音的残片，乐筝改奏更密的手型，乐琵琶与钓太鼓收住。
// 和声不写和弦：笙的合竹就是全部的“和声”。合成版的衬底只是极轻的 E–B 持续音与低处的拨奏（管弦版里换成管弦的长音与低音提琴拨奏）。
import type { TrackDef } from "../score";

/** 一小节的羯鼓（格子是 32 分音符）：第一拍一声“正”，后半小节一串越来越密的“来”，落到下一小节的“正”。 */
const KAKKO_BAR = "K..................." + "r...r..r.r.r";
/** 最后一小节：只有一声“正”，不再引向下一小节。 */
const KAKKO_LAST = "K" + ".".repeat(31);

export const AC_KYOTO: TrackDef = {
  id: "ac_kyoto",
  title: { zh: "宫中的筝", en: "Koto in the Palace" },
  qpm: 60,
  meter: [4, 4],
  key: "E dorian",
  level: 1.42,
  space: 1.2,
  voices: {
    hichi: { inst: "hichiriki", gain: 0.46, pan: -0.06, reverb: 0.42 },
    fue: { inst: "ryuteki", gain: 0.3, pan: -0.22, reverb: 0.46 },
    sho: { inst: "sho", gain: 0.22, pan: 0.16, reverb: 0.5 },
    biwa: { inst: "gakubiwa", gain: 0.4, pan: 0.3, reverb: 0.42 },
    so: { inst: "gakuso", gain: 0.32, pan: -0.32, reverb: 0.44 },
    shoko: { inst: "shoko", gain: 0.42, pan: -0.14, reverb: 0.44 },
    kakko: {
      inst: "perc",
      gain: 0.4,
      pan: 0.12,
      reverb: 0.4,
      pattern: {
        a: { kind: "drum", grid: 0.25, steps: KAKKO_BAR, hits: { K: ["kakko", 0.85], r: ["kakko_rai", 0.5] } },
        end: { kind: "drum", grid: 0.25, steps: KAKKO_BAR.repeat(3) + KAKKO_LAST, hits: { K: ["kakko", 0.85], r: ["kakko_rai", 0.5] } },
        // 音头：后半小节一串片来，把合奏引进 A
        ondo: { kind: "drum", grid: 0.25, steps: ".".repeat(16) + "r...r..r..r.r.r.", hits: { r: ["kakko_rai", 0.5] } },
      },
    },
    taiko: {
      inst: "perc",
      gain: 0.36,
      pan: 0.02,
      reverb: 0.5,
      // 四小节一周期：第三小节第四拍左手轻击“图”，第四小节第一拍右手重击“咚”
      pattern: { kind: "drum", steps: ".".repeat(22) + "m.O" + ".".repeat(7), hits: { m: ["tsuri_me", 0.45], O: ["tsuri_o", 0.9] } },
    },
    // 衬底（合成）：极轻的 E–B 持续音、周期末尾跟着钓太鼓的一下低音拨奏
    bed: {
      inst: "drone",
      gain: 0.1,
      pan: 0,
      reverb: 0.5,
      pattern: { a: { kind: "drone", notes: [40, 47] }, b: { kind: "drone", notes: [45, 52] } },
    },
    thud: { inst: "pizz", gain: 0.18, pan: 0.06, reverb: 0.3 },
  },
  sections: {
    ondo: {
      bars: 1,
      lines: { fue: "!bend!b4 {c'}b a/2f/2 e2" },
    },
    A: {
      bars: 4,
      lines: {
        hichi: "!bend!B6 A2 | F4 A2 B2 | !bend!e4 d2 B2 | !vib!A6 z2",
        fue: "!bend!b4 c'/2b/2a b2 | f3 e a2 b2 | !bend!e'4 d'2 {c'}b2 | !vib!a4 f2 a2",
        sho: "[Befab]6 [Adefa]2 | [Bfabc']4 [Adefa]2 [Befab]2 | [Befabe']4 [Adefad']2 [Befab]2 | [Adefa]8",
        biwa: "E,,/2B,,/2E,/2 B,9/2 z2 | E,,/2B,,/2E,/2 F,9/2 z2 | A,,/2E,/2A,/2 E9/2 z2 | A,,/2E,/2B,/2 A13/2",
        so: "B,/2C/2 B z2 B,/2C/2 B z2 | F,/2A,/2 F z2 F,/2A,/2 F z2 | E,/2F,/2 E z2 E,/2F,/2 E z2 | A,/2B,/2 A z2 E,/2F,/2 E z2",
        kane: "z4 e'/2e'3/2 z2 | e'2 z2 e'/2e'3/2 z2 | z4 e'/2e'3/2 z2 | e'2 z2 e'/2e'3/2 z2",
        low: "z8 | z8 | z8 | E,,,2 z6",
      },
    },
    B: {
      bars: 4,
      lines: {
        hichi: "!bend!F4 A2 B2 | !bend!c4 B2 A2 | F3 A E2 F2 | !fall!E6 z2",
        fue: "!bend!f4 a2 b2 | !bend!c'4 b2 {c'}a2 | f3 a e2 f2 | !fall!e6 z2",
        sho: "[Bfabc']4 [Adefa]2 [Befab]2 | [cfabc']4 [Befab]2 [Adefa]2 | [Bfabc']3 [Adefa] [Befabe']2 [Bfabc']2 | [Befabe']8",
        biwa: "E,,/2B,,/2E,/2 F,9/2 z2 | A,,/2E,/2A,/2 C9/2 z2 | E,,/2B,,/2E,/2 F,9/2 z2 | E,,/2B,,/2E,/2 E13/2",
        so: "F,/2A,/2 F z2 F,/2A,/2 F z2 | C/2E/2 c z2 B,/2C/2 B z2 | F,/2A,/2 F z2 E,/2F,/2 E z2 | E,/2F,/2 E z2 z2 E,/2F,/2 E",
        kane: "z4 e'/2e'3/2 z2 | e'2 z2 e'/2e'3/2 z2 | z4 e'/2e'3/2 z2 | e'2 z6",
        low: "z8 | z8 | z8 | E,,,2 z6",
        // 残乐：筚篥只剩残片，乐筝的手型更密
        frag: "!bend!F4 z4 | z4 B2 A2 | z8 | !fall!E4 z4",
        nokori: "F,/2A,/2 F F/2A/2 f F,/2A,/2 F B,/2C/2 B | C/2E/2 c B,/2C/2 B A,/2B,/2 A B,/2C/2 B | F,/2A,/2 F E,/2F,/2 E F,/2A,/2 F E,/2F,/2 E | E,/2F,/2 E z2 z2 E,/2F,/2 E",
      },
    },
  },
  forms: [
    [
      { s: "ondo", play: "fue:fue kakko.ondo", dyn: 0.56, tempo: 0.92, to: 0.6 },
      { s: "A", play: "hichi:hichi fue:fue sho:sho biwa:biwa so:so kane:shoko kakko taiko bed.a low:thud", dyn: 0.62 },
      { s: "B", play: "hichi:hichi fue:fue sho:sho biwa:biwa so:so kane:shoko kakko.end taiko bed.b low:thud", dyn: 0.64, to: 0.58, rit: 0.88 },
    ],
    [
      { s: "A", play: "hichi:hichi fue:fue sho:sho biwa:biwa so:so kane:shoko kakko taiko bed.a low:thud", dyn: 0.6 },
      { s: "B", play: "frag:hichi biwa:biwa nokori:so taiko bed.b low:thud", dyn: 0.56, to: 0.5, rit: 0.86 },
    ],
  ],
  rest: [8, 14],
};
