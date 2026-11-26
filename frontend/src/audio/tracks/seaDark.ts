// 《黑暗之海》：大西洋深处的“黑暗之海”（阿拉伯地理学家的 Bahr al-Zulumat、拉丁文的 Mare Tenebrosum；亚特兰蒂斯的外围，终日不散的雾）。
// C 上的八音音阶（半音、全音相间：C 降D 降E 还原E 升F G 还原A 降B），5/4 拍（每分钟 56 拍，一小节五秒多），慢、不安、找不到落脚的拍子：
// 低音是 C 与升 F 的三全音持续音（“魔鬼的音程”），高处极轻的弦乐泛音般的长音，钢片琴偶尔一点冷光，远处一口雾钟（还原 A）隔很久响一下；
// 和弦按小三度挪动（C 小 → 降 E 小 → 升 F 小 → A 大），都在这个八音音阶里，听不出哪里是家。
// 开头圆号吹起全作的起帆动机，却走歪了：G → C → 升 F（该回到 G 的地方差了半音）——熟悉的帆，在雾里变了形；尾声再吹一次，仍落不回 G。
// A 段木笛在低处唱一条八音音阶的旋律（还原 A、降 D 这些“不该在”的音），B 段小提琴组在高处唱，和弦是 C、降 E、升 F、A 四个大三和弦一圈圈转，人声在后面“哦”着。
import type { TrackDef } from "../score";

export const SEA_DARK: TrackDef = {
  id: "sea_dark",
  title: { zh: "黑暗之海", en: "Mare Tenebrosum" },
  qpm: 56,
  meter: [5, 4],
  key: "C minor",
  level: 1.25,
  hall: true,
  space: 1.35,
  voices: {
    flute: { inst: "flute", gain: 0.56, pan: -0.14, reverb: 0.55 },
    violins: { inst: "violins", gain: 0.46, pan: -0.24, reverb: 0.6 },
    horns: { inst: "horns", gain: 0.46, pan: 0.26, reverb: 0.6 },
    celesta: { inst: "celesta", gain: 0.36, pan: 0.36, reverb: 0.75 },
    bell: { inst: "bell", gain: 0.34, pan: -0.4, reverb: 0.8 },
    gong: { inst: "gong", gain: 0.3, pan: 0.1, reverb: 0.8 },
    choir: { inst: "choir", gain: 0.26, pan: 0.14, reverb: 0.75, pattern: { kind: "pad", low: 57, high: 74, size: 3 } },
    air: { inst: "strings", gain: 0.22, pan: -0.1, reverb: 0.7, pattern: { kind: "pad", low: 76, high: 91, size: 3 } },
    drone: { inst: "drone", gain: 0.36, reverb: 0.5, pattern: { kind: "drone", notes: [36, 42] } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "Cm | Cm",
      lines: {
        gong: "C,,10 | z10",
        // 走歪了的起帆动机：G → C → 升 F（差了半音，落不回 G）
        motif: "z10 | G,3/2 C/2 ^F6 z2",
      },
    },
    A: {
      bars: 8,
      // 和弦按小三度挪动，都在 C 的八音音阶里
      chords: "Cm | Cm | Ebm | Ebm | F#m | F#m | A | Cm",
      lines: {
        mel: "G4 =A2 G4 | E6 _D4 | ^F4 E2 _D4 | B,10 | =A4 ^F2 =E4 | ^F6 G4 | =A4 =E2 _D4 | C10",
        // 雾钟（还原 A），隔很久响一下
        bell: "=A,10 | z10 | z10 | z10 | =A,10 | z10 | z10 | z10",
        // 冷光
        glint: "z6 c''4 | z10 | z4 ^f'2 z4 | z10 | z6 =a'4 | z10 | z2 _d''2 z6 | z10",
      },
    },
    B: {
      bars: 8,
      chords: "C | Eb | F# | A | C | Eb | F# | Cm",
      lines: {
        bmel: "g6 =e4 | g6 B4 | ^a6 ^f4 | =a6 =e4 | c'6 g4 | B6 g4 | _d6 ^f4 | c10",
        glint: "z10 | z6 g'4 | z10 | z4 =e'2 z4 | z10 | z6 B'4 | z10 | z10",
      },
    },
    outro: {
      bars: 2,
      chords: "Cm | Cm",
      lines: { motif: "G,3/2 C/2 ^F6 z2 | z10", bell: "z10 | =A,10" },
    },
  },
  forms: [
    [
      { s: "intro", play: "gong:gong motif:horns drone air", dyn: 0.5, to: 0.56 },
      { s: "A", play: "mel:flute bell:bell glint:celesta drone air", dyn: 0.58 },
      { s: "B", play: "bmel:violins glint:celesta choir drone", dyn: 0.6, to: 0.64 },
      { s: "A", play: "mel:flute mel:horns-12 bell:bell glint:celesta drone air choir", dyn: 0.6 },
      { s: "outro", play: "motif:horns bell:bell drone air", dyn: 0.52, to: 0.36, rit: 0.85 },
    ],
    [
      { s: "intro", play: "gong:gong motif:horns drone", dyn: 0.48, to: 0.54 },
      { s: "B", play: "bmel:violins glint:celesta choir drone", dyn: 0.58, to: 0.62 },
      { s: "A", play: "mel:flute bell:bell glint:celesta drone air", dyn: 0.6 },
      { s: "outro", play: "motif:horns bell:bell drone air", dyn: 0.5, to: 0.34, rit: 0.85 },
    ],
  ],
  rest: [30, 50],
};
