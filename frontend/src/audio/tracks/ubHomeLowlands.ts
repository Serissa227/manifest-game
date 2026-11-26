// 《运河边的晾衣绳》：养成篇·家乡的日常——低地国家（莉芙的安特卫普）。旋律原创。
// 运河边的窄屋：窗下一架维金纳琴（安特卫普自己造的那种），晾衣绳横过小巷；圣母主教堂的钟楼每一刻钟奏一段小曲，整座城都听得见。
// G 大调，4/4（每分钟 92 拍），写成当时安特卫普印的那种荷兰语歌（一句一句地走、好唱）：
// - 引子：钟楼的排钟（beiaard）奏报时前的一串下行，大钟敲一下；
// - A：维金纳琴右手唱主题、左手弹分解的低音；第三小节就是养成篇的成长动机（D → G → A → B：5 → 1 → 2 → 3）；
// - A′：两支克鲁姆管加进来，一支吹中声部（多是三度、六度）、一支吹低音——苏萨托那种合奏的样子；
// - B：转到 E 小调一侧，雷贝克琴（小提琴的老前辈）唱一段带点心事的旋律，落在 D 上；
// - A″：钟楼的排钟在高处奏主题，克鲁姆管奏中低声部；尾声维金纳琴收，大钟再响一下。
// 和声是文艺复兴的三和弦（这种音乐本来就有）；没有鼓。衬底（合成的弦乐长音与拨奏低音）很轻，管弦版换成真的弦乐。
import type { TrackDef } from "../score";

export const UB_HOME_LOWLANDS: TrackDef = {
  id: "ub_home_lowlands",
  title: { zh: "运河边的晾衣绳" },
  qpm: 92,
  meter: [4, 4],
  key: "G major",
  voices: {
    virg: { inst: "virginal", gain: 0.62, pan: -0.12, reverb: 0.28 },
    vl: { inst: "virginal", gain: 0.34, pan: -0.2, reverb: 0.26, pattern: { kind: "arp", low: 43, steps: "1 . 5 . 8 . 5 .", ring: 2 } },
    bells: { inst: "beiaard", gain: 0.3, pan: 0.18, reverb: 0.5 },
    crum: { inst: "crumhorn", gain: 0.3, pan: 0.12, reverb: 0.3 },
    crum2: { inst: "crumhorn", gain: 0.3, pan: 0.26, reverb: 0.28 },
    rebeck: { inst: "rebeck", gain: 0.46, pan: 0.06, reverb: 0.32 },
    // 衬底（合成）：很轻的弦乐长音与拨奏低音
    pad: { inst: "strings", gain: 0.12, pan: -0.22, reverb: 0.42, pattern: { kind: "pad", low: 55, high: 69, size: 3 } },
    pz: { inst: "pizz", gain: 0.2, pan: 0.06, reverb: 0.16, pattern: { kind: "arp", low: 38, steps: "1 . . . 5, . . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "G | G",
      lines: {
        // 报时前的一串下行，大钟一响
        chime: "g/2f/2e/2d/2 c/2B/2A/2G/2 B2 d2 | G4 z4",
      },
    },
    A: {
      bars: 8,
      chords: "G | C | G | D | Em | C | D | G",
      lines: {
        mel: "G2 B2 d3 B | c2 e2 d2 c2 | D2 G2 A2 B2 | A6 z2 | B2 e2 e3 d | c2 e2 g3 e | d2 =c2 B2 A2 | G6 z2",
        alt: "D4 G3 G | E2 G2 G2 E2 | B,2 D2 F2 G2 | F6 z2 | G2 B2 B3 B | E2 G2 c3 G | F2 A2 G2 F2 | D6 z2",
        ten: "G,4 B,4 | C4 A,4 | G,4 E,4 | D,6 z2 | E,4 G,4 | C,4 E,4 | D,4 F,4 | G,6 z2",
      },
    },
    B: {
      bars: 8,
      chords: "Em | Am | D | G | C | G/B | Am | D",
      lines: {
        bm: "B3 c B2 G2 | A3 B c2 e2 | d3 c B2 A2 | B6 z2 | e3 d c2 e2 | d3 c B2 G2 | c3 B A2 c2 | A6 z2",
        balt: "G4 E4 | E4 A4 | F4 F4 | D4 G4 | G4 E4 | G4 D4 | E4 A,4 | F6 z2",
        bbass: "E,4 B,,4 | A,,4 E,4 | D,4 A,,4 | G,,4 D,4 | C,4 G,4 | B,,4 D,4 | A,,4 C,4 | D,6 z2",
      },
    },
    coda: {
      bars: 4,
      chords: "C | G | D | G",
      lines: {
        endm: "e2 d2 c2 e2 | d4 B4 | A2 B2 c2 A2 | G8",
        endb: "C,4 E,4 | G,4 G,,4 | D,4 D,,4 | G,,8",
        chime2: "z8 | z8 | z8 | G4 z4",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "chime:bells pad", dyn: 0.56 },
      { s: "A", play: "mel:virg vl pad", dyn: 0.58 },
      { s: "A", play: "mel:virg alt:crum ten:crum2 vl pz", dyn: 0.62 },
      { s: "B", play: "bm:rebeck balt:crum bbass:crum2 pad", dyn: 0.6 },
      { s: "A", play: "mel:bells alt:crum ten:crum2 vl pz pad", dyn: 0.64, to: 0.6 },
      { s: "coda", play: "endm:virg endb:crum2 chime2:bells pad", dyn: 0.56, to: 0.4, rit: 0.84 },
    ],
    [
      { s: "intro", play: "chime:bells", dyn: 0.54 },
      { s: "A", play: "mel:bells vl pad", dyn: 0.58 },
      { s: "B", play: "bm:virg bbass:pz pad", dyn: 0.58 },
      { s: "A", play: "mel:virg alt:crum ten:crum2 vl pz", dyn: 0.62 },
      { s: "B", play: "bm:rebeck balt:crum bbass:crum2 vl pad", dyn: 0.62 },
      { s: "A", play: "mel:rebeck alt:crum ten:crum2 vl pz pad", dyn: 0.64, to: 0.6 },
      { s: "coda", play: "endm:virg endb:crum2 chime2:bells pad", dyn: 0.56, to: 0.4, rit: 0.84 },
    ],
  ],
  rest: [10, 16],
  level: 1.1,
};
