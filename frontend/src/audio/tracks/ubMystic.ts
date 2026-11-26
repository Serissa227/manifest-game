// 《子夜的征兆》：养成篇的事件 · 神秘（秘术的征兆、夜里看见的彗星、书页里夹着的东西）。E 弗里吉亚，慢 4/4（每分钟 60 拍），夜里、安静、有点冷。
// A 段低音一直守着 E（E–B 空五度的持续音），上面的和弦在 E 小、F 大七、A 小、D 小之间挪动——脚下不动、头顶的星在转；
// 木笛在低音区唱一条像咏唱的旋律（E → F 的半音是弗里吉亚的阴影）；钢片琴偶尔闪出三个音的“征兆”（B → C → F，夹着一个三全音），
// 不按拍子来，像夜空里一闪就没的光。B 段离开持续音：C 大 → 降 A 大 → F 小 → C 大（隔着三度的和弦挪动，像翻开一本不该翻的书），
// 圆号在中音区慢慢唱，最后落在 B 大三和弦上（升 D 的那一下“亮”），再回到 E。开头一声很轻的锣、定音鼓在 E 上滚奏。
import type { TrackDef } from "../score";

export const UB_MYSTIC: TrackDef = {
  id: "ub_mystic",
  title: { zh: "子夜的征兆", en: "Omens at Midnight" },
  qpm: 60,
  meter: [4, 4],
  key: "E phrygian",
  level: 1.2,
  space: 1.25,
  voices: {
    flute: { inst: "flute", gain: 0.56, pan: -0.12, reverb: 0.5 },
    horns: { inst: "horns", gain: 0.46, pan: 0.26, reverb: 0.5 },
    celesta: { inst: "celesta", gain: 0.42, pan: -0.34, reverb: 0.66 },
    choir: { inst: "choir", gain: 0.3, pan: 0.18, reverb: 0.66, pattern: { kind: "pad", low: 59, high: 76, size: 3 } },
    air: { inst: "strings", gain: 0.3, pan: -0.16, reverb: 0.6, pattern: { kind: "pad", low: 67, high: 84, size: 3 } },
    drone: { inst: "drone", gain: 0.34, reverb: 0.4, pattern: { kind: "drone", notes: [40, 47] } },
    low: { inst: "strings", gain: 0.34, pan: 0.06, reverb: 0.4, pattern: { kind: "pad", low: 36, high: 48, size: 1 } },
    timp: { inst: "timpani", gain: 0.32, reverb: 0.5 },
    gong: { inst: "gong", gain: 0.3, pan: 0.1, reverb: 0.7 },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "Em | Fmaj7/E",
      lines: {
        gong: "E,,8 | z8",
        timp: "!trem!E,,8- | E,,4 z4",
        omen: "z8 | z4 b c' f'2",
      },
    },
    A: {
      bars: 8,
      chords: "Em | Fmaj7/E | Em | Fmaj7/E | Am/E | Fmaj7/E | Dm/E | Em",
      lines: {
        // 像咏唱的旋律，E → F 的半音是弗里吉亚的阴影
        mel: "E2 F2 G4 | A4 G2 F2 | G2 F2 E4 | F8 | A2 B2 c4 | c2 B2 A4 | A2 G2 F4 | E8",
        // 三个音的征兆：B → C → F
        omen: "z8 | z4 b c' f'2 | z8 | z8 | z8 | z2 b c' f'2 z2 | z8 | z8",
      },
    },
    B: {
      bars: 8,
      // 隔着三度的和弦挪动，最后落在 B 大三和弦上
      chords: "C | Ab | Fm | C | Am | F | Dm | B",
      lines: {
        bmel: "E3 F G4 | _E3 D C4 | _A4 F4 | G8 | A3 B c4 | c3 B A4 | d4 f4 | ^f4 ^d4",
        omen: "z8 | z8 | z4 _a c' _e'2 | z8 | z8 | z8 | z8 | z2 ^d' ^f' b'2 z2",
        timp: "z8 | z8 | z8 | z8 | z8 | z8 | z8 | !trem!B,,8",
      },
    },
    outro: {
      bars: 2,
      chords: "Em | Em",
      lines: { tag: "G4 F4 | E8", omen: "z4 b c' f'2 | z8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "gong:gong timp:timp omen:celesta drone air", dyn: 0.5, to: 0.56 },
      { s: "A", play: "mel:flute omen:celesta drone air", dyn: 0.58 },
      { s: "B", play: "bmel:horns omen:celesta timp:timp choir low", dyn: 0.6, to: 0.66 },
      { s: "A", play: "mel:flute mel:horns-12 omen:celesta drone air choir", dyn: 0.6 },
      { s: "outro", play: "tag:flute omen:celesta drone air", dyn: 0.52, to: 0.36, rit: 0.85 },
    ],
    [
      { s: "intro", play: "gong:gong omen:celesta drone", dyn: 0.48, to: 0.54 },
      { s: "A", play: "mel:horns-12 omen:celesta drone air", dyn: 0.56 },
      { s: "B", play: "bmel:flute omen:celesta timp:timp choir low", dyn: 0.6, to: 0.66 },
      { s: "A", play: "mel:flute omen:celesta drone air choir", dyn: 0.58 },
      { s: "outro", play: "tag:flute omen:celesta drone air", dyn: 0.5, to: 0.34, rit: 0.85 },
    ],
  ],
  rest: [8, 14],
};
