// 《鼓语与金沙》：曼丁人的海岸（塞内冈比亚与几内亚上游的河口——冈比亚河、卡萨芒斯、里奥努内斯：
// 班布克与布雷的金沙顺河下来，格里奥在王廷与集市上弹着科拉琴唱家谱与赞辞）。
// 这一首的乐器全是曼丁与富拉人的（科拉琴、恩戈尼、巴拉丰、金贝鼓、敦敦鼓；说话鼓在这里是沃洛夫与曼丁人的“塔马”），
// 留给寰宇数据里曼丁、塞内冈比亚风格的港口（PORT_STYLE_TRACK 的 mande / senegambia / west_african……）；
// 贝宁湾（贝宁王国的瓜托）另有《胡椒与铜手镯》port_benin，葡萄牙的埃尔米纳、圣多美按葡萄牙。
// 地方特色第二阶段·非洲：曼丁的乐器领奏（复古合成版的衬底用合成的大提琴组与持续音）。旋律原创。
// C 上的“哈尔迪诺”（科拉琴的一种调弦，近于大调），4/4（每分钟 100 拍），十六分音符的律动：
// - 引子：说话鼓“念”一句（低 低 往上滑 · 高 高 往下落），金贝鼓应一句；科拉琴的“昆本戈”进来；
// - A：科拉琴两只拇指拨低音、两只食指拨高音，四小节一圈的昆本戈（C | F | C | G 的“地方”来回摆），
//   第二把科拉琴在上面唱一条格里奥式的、从高处一级级落下来的旋律；敦敦鼓与铁铃、谢凯雷沙铃打着骨架；
// - B：巴拉丰（葫芦膜嗞嗞响的木琴）领奏一段十六分音符的快句、重复音与滚奏，金贝鼓的伴奏型全上；
// - C：“鼓语”——说话鼓问两小节、金贝鼓答两小节，科拉琴只拨低音留出空；
// - A″：巴拉丰接过旋律，恩戈尼小琉特加一个切分的音型，说话鼓在句尾插话；尾声科拉琴一串落下来。
// 和声：科拉琴的昆本戈本身勾出和声的“地方”（曼丁的科拉琴音乐确实如此），衬底只拉空五度（C–G、F–C、G–D），不写三和弦的长音。
import type { TrackDef } from "../score";

/** 一小节的格子重复 n 遍（小节线分开）。 */
const rep = (bar: string, n: number) => Array.from({ length: n }, () => bar).join(" | ");

/** 科拉琴的昆本戈：每拍 [拇指的低音, 食指的高音, 中音, 食指的高音]，三种“地方”。 */
const KC = "C,/2G/2E/2c/2 G,/2G/2E/2c/2 C,/2G/2E/2d/2 G,/2G/2E/2c/2";
const KF = "F,/2A/2F/2c/2 C/2A/2F/2c/2 F,/2A/2F/2d/2 C/2A/2F/2c/2";
const KG = "G,/2B/2G/2d/2 D/2B/2G/2d/2 G,/2B/2G/2e/2 D/2B/2G/2d/2";
const CYCLE = [KC, KF, KC, KG].join(" | ");
/** 恩戈尼的切分音型（与昆本戈同一圈）。 */
const NC = "C/2C/2 E G/2E/2 c/2G/2 E C/2G/2 E/2C/2 G,/2C/2";
const NF = "F/2F/2 A c/2A/2 f/2c/2 A F/2c/2 A/2F/2 C/2F/2";
const NG = "G/2G/2 B d/2B/2 g/2d/2 B G/2d/2 B/2G/2 D/2G/2";
/** 四小节的和声“地方”（衬底的空五度跟着它走）。 */
const CHORDS = "C5 | F5 | C5 | G5";

export const PORT_GUINEA: TrackDef = {
  id: "port_guinea",
  title: { zh: "鼓语与金沙", en: "Drum Speech and Gold Dust" },
  qpm: 100,
  meter: [4, 4],
  key: "C major",
  voices: {
    kora: { inst: "kora", gain: 0.4, pan: -0.2, reverb: 0.26 },
    kora2: { inst: "kora", gain: 0.5, pan: 0.12, reverb: 0.28 },
    balafon: { inst: "balafon", gain: 0.46, pan: 0.26, reverb: 0.26 },
    ngoni: { inst: "ngoni", gain: 0.34, pan: -0.34, reverb: 0.22 },
    gangan: {
      inst: "perc",
      gain: 0.36,
      pan: 0.2,
      reverb: 0.3,
      pattern: {
        intro: {
          kind: "drum",
          grid: 0.5,
          steps: "l.lU..h.hhD.....................h.hU..l.lUhD...mD...............",
          hits: { l: ["gangan_lo", 0.7], h: ["gangan_hi", 0.7], U: ["gangan_up", 0.85], D: ["gangan_down", 0.85], m: ["gangan_mid", 0.6] },
        },
        a: { kind: "drum", grid: 0.5, steps: "................l.lU..h.D.......", hits: { l: ["gangan_lo", 0.55], h: ["gangan_hi", 0.55], U: ["gangan_up", 0.65], D: ["gangan_down", 0.65] } },
        c: {
          kind: "drum",
          grid: 0.5,
          steps: "l.lU..h.hhD.....................h.hU..l.lUhD...mD...............",
          hits: { l: ["gangan_lo", 0.75], h: ["gangan_hi", 0.75], U: ["gangan_up", 0.9], D: ["gangan_down", 0.9], m: ["gangan_mid", 0.65] },
        },
        coda: { kind: "drum", grid: 0.5, steps: "U...D...........", hits: { U: ["gangan_up", 0.85], D: ["gangan_down", 0.9] } },
      },
    },
    djembe: {
      inst: "perc",
      gain: 0.28,
      pan: -0.08,
      reverb: 0.24,
      pattern: {
        a: { kind: "drum", grid: 0.5, steps: "B.ttS.t.B.ttS.S.", hits: { B: ["djembe_bass", 0.7], t: ["djembe_tone", 0.5], S: ["djembe_slap", 0.6] } },
        // 引子与“鼓语”：说话鼓问的时候不打，答的时候一齐上
        intro: {
          kind: "drum",
          grid: 0.5,
          steps: "................S.SSt.t.S.SSB...................S.S.S.S.B.B.B...",
          hits: { B: ["djembe_bass", 0.8], t: ["djembe_tone", 0.6], S: ["djembe_slap", 0.75] },
        },
        c: {
          kind: "drum",
          grid: 0.5,
          steps: "................S.SSt.t.S.SSB...................S.S.S.S.B.B.B...",
          hits: { B: ["djembe_bass", 0.85], t: ["djembe_tone", 0.65], S: ["djembe_slap", 0.8] },
        },
        coda: { kind: "drum", grid: 0.5, steps: "S.S.S...B.......", hits: { B: ["djembe_bass", 0.85], S: ["djembe_slap", 0.8] } },
      },
    },
    dundun: {
      inst: "perc",
      gain: 0.3,
      pan: 0.04,
      reverb: 0.22,
      pattern: {
        a: { kind: "drum", grid: 0.5, steps: "B...b...S.S.....", hits: { B: ["dundun_ba", 0.75], b: ["dundun_ba_m", 0.55], S: ["dundun_sang", 0.6] } },
        c: { kind: "drum", grid: 0.5, steps: "B...............", hits: { B: ["dundun_ba", 0.6] } },
        coda: { kind: "drum", grid: 0.5, steps: "B...B...........", hits: { B: ["dundun_ba", 0.85] } },
      },
    },
    ken: { inst: "perc", gain: 0.2, pan: 0.18, reverb: 0.22, pattern: { kind: "drum", grid: 0.5, steps: "..k...k...k...k.", hits: { k: ["dundun_ken", 0.5] } } },
    bell: { inst: "perc", gain: 0.15, pan: 0.32, reverb: 0.24, pattern: { kind: "drum", grid: 0.5, steps: "x.x.xx.xx.x.xx.x", hits: { x: ["dundun_bell", 0.5] } } },
    shekere: { inst: "perc", gain: 0.2, pan: -0.34, reverb: 0.22, pattern: { kind: "drum", grid: 0.5, steps: "S.sSS.sSS.sSS.sS", hits: { S: ["shekere", 0.5], s: ["shekere_soft", 0.35] } } },
    // 衬底（合成）：大提琴组拉根音的长音，空五度的持续音跟着和声的“地方”走
    low: { inst: "celli", gain: 0.2, pan: 0.12, reverb: 0.26 },
    pad: { inst: "drone", gain: 0.15, pan: -0.18, reverb: 0.42, pattern: { kind: "pad", low: 48, high: 64, size: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "C5 | C5 | F5 | G5",
      lines: { kin: `z8 | z8 | ${KF} | ${KG}`, root: "C,,8 | C,,8 | F,,8 | G,,8" },
    },
    A: {
      bars: 8,
      chords: rep(CHORDS, 2),
      lines: {
        kumb: rep(CYCLE, 2),
        // 格里奥式的旋律：从高处一级级落下来
        mel: "g2 g e d2 c2 | c2 A c d4 | e2 e d c2 A2 | B2 A G A4 | g2 a g e2 d2 | f2 e d c2 A2 | G2 A c e2 d2 | d2 c B c4",
        nost: rep([NC, NF, NC, NG].join(" | "), 2),
        root: rep("C,,8 | F,,8 | C,,8 | G,,8", 2),
      },
    },
    B: {
      bars: 8,
      chords: rep(CHORDS, 2),
      lines: {
        kumb: rep(CYCLE, 2),
        // 巴拉丰的快句：重复音、十六分音符、长音用滚奏
        bmel:
          "c/2c/2e/2g/2 a/2g/2e/2c/2 d/2c/2A/2G/2 A/2c/2d | f/2f/2a/2f/2 c/2A/2c/2d/2 f2 !trem!c2 | e/2e/2g/2e/2 d/2c/2A/2c/2 e/2d/2c/2A/2 G2 | B/2d/2B/2A/2 G/2A/2B/2d/2 !trem!d4 | " +
          "c/2c/2e/2g/2 a/2g/2e/2c/2 d/2c/2A/2G/2 A/2c/2d | f/2f/2a/2f/2 c/2A/2c/2d/2 f2 !trem!c2 | g/2e/2d/2c/2 A/2c/2d/2e/2 g/2a/2g/2e/2 d/2c/2A/2c/2 | B/2A/2G/2A/2 B/2d/2B/2A/2 !trem!G4",
        root: rep("C,,8 | F,,8 | C,,8 | G,,8", 2),
      },
    },
    C: {
      bars: 4,
      chords: CHORDS,
      lines: {
        // 科拉琴只拨拇指的低音，让出“鼓语”的空
        kbass: "C,2 z2 G,2 z2 | F,2 z2 C2 z2 | C,2 z2 G,2 z2 | G,2 z2 D2 z2",
        root: "C,,8 | F,,8 | C,,8 | G,,8",
      },
    },
    coda: {
      bars: 2,
      chords: "C5 | C5",
      lines: { end: "c'/2b/2a/2g/2 e/2d/2c/2A/2 G/2E/2D/2C/2 [C,G,C]2 | z8", root: "C,,8 | C,,8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "gangan.intro djembe.intro kin:kora root:low pad", dyn: 0.62, to: 0.68 },
      { s: "A", play: "kumb:kora mel:kora2 dundun.a ken bell shekere root:low pad", dyn: 0.66 },
      { s: "B", play: "kumb:kora bmel:balafon djembe.a dundun.a ken bell shekere root:low pad", dyn: 0.7 },
      { s: "C", play: "kbass:kora gangan.c djembe.c dundun.c bell root:low pad", dyn: 0.68 },
      { s: "A", play: "kumb:kora nost:ngoni mel:balafon djembe.a dundun.a ken bell shekere gangan.a root:low pad", dyn: 0.74 },
      { s: "coda", play: "end:kora2 gangan.coda djembe.coda dundun.coda root:low", dyn: 0.74, rit: 0.9 },
    ],
    [
      { s: "A", play: "kumb:kora mel:kora2 dundun.a ken bell shekere root:low pad", dyn: 0.64 },
      { s: "C", play: "kbass:kora gangan.c djembe.c dundun.c bell root:low pad", dyn: 0.66 },
      { s: "B", play: "kumb:kora bmel:balafon djembe.a dundun.a ken bell shekere root:low pad", dyn: 0.7 },
      { s: "coda", play: "end:kora2 gangan.coda djembe.coda dundun.coda root:low", dyn: 0.72, rit: 0.9 },
    ],
  ],
  rest: [10, 18],
  level: 1.08,
};
