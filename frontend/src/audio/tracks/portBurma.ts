// 《勃固的鼓圈》：缅甸的港口（勃固、沙廉、马达班——东吁王朝的金塔与码头）。地方特色第二阶段：缅甸的 hsaing waing 乐队领奏。
// 调：C 上的五声（C D E G A，偶尔经过 F、B），缅甸音乐里常见的“hnyin lon”一类；B 段转到 F 上的五声（弯琴的室内乐）。
// 4/4（每分钟 108 拍），锡（铃钹）与瓦（竹响板）每拍轮流——锡在弱拍、瓦在强拍，整个乐队跟着它们走：
// - 引子：鼓圈从高到低一口气扫下来（手掌压着鼓皮的滑音），帕玛吊鼓“嘭”地一响，突然停住，赫奈一声长喊；
// - A：鼓圈领奏——快的十六分音符、同音的连打、句尾往下一滑，左手在低八度一砸；锣圈在下面奏同一条旋律的简单说法；第二遍赫奈加入（又尖又颤）；
// - B：宫廷的室内乐：弯琴（缅甸竖琴）独自唱，左手拨几个低音，锡与瓦轻下来，速度放慢一点；
// - A′：全体回来，第四小节后半突然全停（缅甸音乐的脾气：说停就停），帕玛一响再一起进来，越奏越快；
//   停顿单独成一段（A2s，一小节：前半齐奏到 G、后半全停），这一段不放衬底——管弦版的弦乐持续音也跟着停，静下来的就是整个乐队，不是“乐队退下、弦乐垫底”；
// - 尾声：鼓圈一句，锣圈与赫奈收在 C 上。
// 和声只有很轻的 C–G 空五度持续音。
import type { TrackDef } from "../score";

/** 取一行旋律的第 from 到第 to 小节（从 1 起，含两端）。 */
function barsOf(lineAbc: string, from: number, to: number): string {
  return lineAbc
    .split("|")
    .map((b) => b.trim())
    .slice(from - 1, to)
    .join(" | ");
}

/** 鼓圈的旋律（A 段）。 */
const PAT_A =
  "c2 c/2d/2c/2A/2 G2 A c | d2 !fall!e2 d c A G | E G A c d/2e/2d/2c/2 A2 | G4 z2 [G,G]2 | " +
  "e2 g2 !fall!e2 d c | d/2e/2d/2c/2 A G A2 c2 | G/2A/2c/2d/2 e/2d/2c/2A/2 G2 E D | C2 G,2 [C,C]4";
/** 锣圈：同一条旋律的简单说法（四分音符，句尾隔八度）。 */
const KYI_A = "c2 c2 G2 c2 | d2 e2 c2 G2 | E2 A2 d2 A2 | [G,G]4 z2 [G,G]2 | e2 g2 e2 c2 | d2 A2 A2 c2 | G2 e2 G2 D2 | C2 G,2 [C,C]4";
/** 赫奈：拉长了、颤着、滑着唱。 */
const HNE_A = "!bend!c4 G2 A c | !vib!d4 !bend!e2 c G | E G A c !bend!d4 | !vib!G4 z2 G2 | !bend!e4 g2 !fall!e2 | {e}d4 A2 c2 | G A c d !bend!e2 D2 | !vib!C6 z2";

export const PORT_BURMA: TrackDef = {
  id: "port_burma",
  title: { zh: "勃固的鼓圈", en: "Drum Circle of Pegu" },
  qpm: 108,
  meter: [4, 4],
  key: "C major",
  voices: {
    pat: { inst: "pat_waing", gain: 0.4, pan: -0.1, reverb: 0.3 },
    kyi: { inst: "kyi_waing", gain: 0.24, pan: 0.24, reverb: 0.32 },
    hne: { inst: "hne", gain: 0.36, pan: 0.08, reverb: 0.34 },
    saung: { inst: "saung_gauk", gain: 0.5, pan: -0.14, reverb: 0.36 },
    siwa: {
      inst: "perc",
      gain: 0.22,
      pan: 0.3,
      reverb: 0.26,
      pattern: {
        // 每拍轮流：锡（弱）— 瓦（强）
        a: { kind: "drum", steps: "s.w.s.w.", hits: { s: ["si", 0.7], w: ["wa", 0.8] } },
        soft: { kind: "drum", steps: "s...w...", hits: { s: ["si", 0.55], w: ["wa", 0.6] } },
        // A′：四小节一圈，最后一小节后半不奏（A2a 只用到前三小节；A2b 的第四小节是句尾的长音）
        brk: { kind: "drum", steps: "s.w.s.w.s.w.s.w.s.w.s.w.s.w.....", hits: { s: ["si", 0.75], w: ["wa", 0.85] } },
        // 停顿的那一小节：前两拍照奏，后两拍突然全停
        stop: { kind: "drum", steps: "s.w.....", hits: { s: ["si", 0.75], w: ["wa", 0.85] } },
        coda: { kind: "drum", steps: "s.w.s.w.w.......", hits: { s: ["si", 0.8], w: ["wa", 0.9] } },
      },
    },
    patma: {
      inst: "perc",
      gain: 0.3,
      pan: 0.02,
      reverb: 0.42,
      pattern: {
        a: { kind: "drum", steps: "........................B.....B.", hits: { B: ["pat_ma", 0.75] } },
        intro: { kind: "drum", steps: "........B.......", hits: { B: ["pat_ma", 0.85] } },
        // A′ 的开头与停顿之后“嘭”地一起进来（A2a、A2b 各用一次，每段的第一拍）
        brk: { kind: "drum", steps: "B...............................", hits: { B: ["pat_ma", 0.9] } },
        coda: { kind: "drum", steps: "......B.B.......", hits: { B: ["pat_ma", 0.9] } },
      },
    },
    // 衬底（合成）：很轻的 C–G 空五度，低音拨奏在句尾点一下
    pad: { inst: "drone", gain: 0.1, pan: -0.16, reverb: 0.46, pattern: { kind: "drone", notes: [36, 43] } },
    bass: { inst: "pizz", gain: 0.22, pan: 0.08, reverb: 0.2 },
  },
  sections: {
    intro: {
      bars: 2,
      lines: {
        // 一口气从高扫到低，低八度一砸，停住，再往下一滑
        pat: "c/2d/2e/2g/2 a/2g/2e/2d/2 c/2A/2G/2E/2 D/2C/2A,/2G,/2 | [C,C]2 z4 !fall!G2",
        hne: "!bend!c6 !fall!A2 | z8",
      },
    },
    A: {
      bars: 8,
      lines: { pat: PAT_A, kyi: KYI_A, hne: HNE_A, low: "z8 | z8 | z8 | z6 G,,2 | z8 | z8 | z8 | C,2 z6" },
    },
    // A′ 分三段：前三小节（A2a）、突然停住的一小节（A2s）、帕玛一响再进来的后四小节（A2b）。
    // 停顿单独成段，是为了让衬底（合成版的持续音、管弦版的弦乐）在这一小节里不响——持续音一铺就是整段，没法只停半小节。
    A2a: {
      bars: 3,
      lines: { pat: barsOf(PAT_A, 1, 3), kyi: barsOf(KYI_A, 1, 3), hne: barsOf(HNE_A, 1, 3), low: "z8 | z8 | z8" },
    },
    A2s: {
      bars: 1,
      // 前两拍全体齐奏到 G（低八度一砸），后两拍一个音也没有
      lines: { pat: "G4 z4", kyi: "[G,G]4 z4", hne: "!vib!G4 z4", low: "G,,4 z4" },
    },
    A2b: {
      bars: 4,
      lines: { pat: barsOf(PAT_A, 5, 8), kyi: barsOf(KYI_A, 5, 8), hne: barsOf(HNE_A, 5, 8), low: "C,2 z6 | z8 | z8 | C,2 z6" },
    },
    B: {
      bars: 8,
      lines: {
        // 弯琴：F 上的五声，按弦推音、揉弦
        saung: "F G A c d2 c A | !bend!c4 A G F2 | D F G A c2 !bend!d2 | !vib!c6 z2 | f2 d c A c d f | !bend!g4 f d c2 | A c d c A G F D | !vib!F6 z2",
        // 弯琴的左手：几个低音
        sl: "F,4 C4 | F,4 z4 | D,4 A,4 | C4 F,4 | F,4 C4 | C4 z4 | F,4 D,4 | F,4 z4",
      },
    },
    coda: {
      bars: 2,
      lines: {
        pat: "c/2d/2e/2g/2 e/2d/2c/2A/2 G/2A/2c/2d/2 !fall!c2 | [C,C]2 z6",
        kyi: "c2 G2 A2 c2 | [C,C]2 z6",
        hne: "!bend!c4 d e !fall!c2 | z8",
        low: "z8 | C,2 z6",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "pat:pat hne:hne patma.intro pad", dyn: 0.68 },
      { s: "A", play: "pat:pat kyi:kyi siwa patma pad low:bass", dyn: 0.68 },
      { s: "A", play: "pat:pat kyi:kyi hne:hne siwa patma pad low:bass", dyn: 0.72 },
      { s: "B", play: "saung:saung sl:saung siwa.soft pad", dyn: 0.58, tempo: 0.9 },
      // 原来一整段 A′ 从 1 渐快到 1.06；分成三段后各段接着同一条速度线（1 → 1.0225 → 1.03 → 1.06），每个音的时刻不变（时间抖动的随机数除外）
      { s: "A2a", play: "pat:pat kyi:kyi hne:hne siwa.brk patma.brk pad low:bass", dyn: 0.74, rit: 1.0225 },
      { s: "A2s", play: "pat:pat kyi:kyi hne:hne siwa.stop low:bass", dyn: 0.74, tempo: 1.0225, rit: 1.03 },
      { s: "A2b", play: "pat:pat kyi:kyi hne:hne siwa.brk patma.brk pad low:bass", dyn: 0.74, tempo: 1.03, rit: 1.06 },
      { s: "coda", play: "pat:pat kyi:kyi hne:hne siwa.coda patma.coda low:bass", dyn: 0.78, tempo: 1.06, rit: 0.94 },
    ],
    [
      { s: "A", play: "pat:pat kyi:kyi hne:hne siwa patma pad low:bass", dyn: 0.7 },
      { s: "B", play: "saung:saung sl:saung siwa.soft pad", dyn: 0.58, tempo: 0.9 },
      // 原来一整段 A′ 从 1 渐快到 1.06；分成三段后各段接着同一条速度线（1 → 1.0225 → 1.03 → 1.06），每个音的时刻不变（时间抖动的随机数除外）
      { s: "A2a", play: "pat:pat kyi:kyi hne:hne siwa.brk patma.brk pad low:bass", dyn: 0.74, rit: 1.0225 },
      { s: "A2s", play: "pat:pat kyi:kyi hne:hne siwa.stop low:bass", dyn: 0.74, tempo: 1.0225, rit: 1.03 },
      { s: "A2b", play: "pat:pat kyi:kyi hne:hne siwa.brk patma.brk pad low:bass", dyn: 0.74, tempo: 1.03, rit: 1.06 },
      { s: "coda", play: "pat:pat kyi:kyi hne:hne siwa.coda patma.coda low:bass", dyn: 0.78, tempo: 1.06, rit: 0.94 },
    ],
  ],
  rest: [10, 18],
  level: 1.38,
};
