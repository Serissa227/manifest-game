// 《酒色的海湾》：希腊与黎凡特的港口（爱琴海诸岛、克里特、塞浦路斯，贝鲁特、西顿、的黎波里、阿卡……希腊水手与黎凡特商人混在一起的码头）。
// 地方特色第二阶段：地方乐器领奏（复古合成版的衬底用合成的持续音与拨奏低音）。
// 7/8 拍（3 + 2 + 2）——在希腊是卡拉马蒂亚诺斯舞，在阿拉伯是“印度圈”（dawr hindi）的乌苏尔，两边都认得；每分钟 126 拍。
// D 上的巴亚提（D E半降 F G A 降B C：第二级降四分之一音；希腊的“乌沙克”也这样把第二级唱低），B 段转到希腊人最爱的希贾兹（“希扎兹”：降 E 与升 F）：
// - 引子：布祖克琴的塔克西姆（拨片的震音长音、一串上行），奈伊笛在空处应两声，下面只有 D–A 的持续音；
// - A：布祖克领奏（黎凡特的咖啡馆），卡农琴高八度异音跟着，劳托扫空五度的“孔特拉”，达布卡打 3 + 2 + 2；
// - A′：同一条旋律交给爱琴海的里拉琴（高八度，倚音、回旋音、句尾往下落），弓上的小铃跟着拍子轻轻响；
// - B：里拉琴唱希扎兹，布祖克低八度跟着，劳托改成密的扫弦，里克鼓加进来；
// - A″：布祖克、里拉琴、奈伊笛、卡农琴一起（希腊与黎凡特同一条旋律的异音齐奏）；尾声布祖克与劳托收在 D 上。
// 和声不用西洋的和弦进行：只有空五度（D5、C5、G5）与劳托扫出来的空五度。旋律原创。
import type { TrackDef } from "../score";

export const PORT_LEVANT: TrackDef = {
  id: "port_levant",
  title: { zh: "酒色的海湾", en: "The Wine-Dark Harbour" },
  qpm: 126,
  meter: [7, 8],
  key: "D bayati",
  voices: {
    buzuq: { inst: "buzuq", gain: 0.56, pan: -0.18, reverb: 0.26 },
    lyra: { inst: "lyra", gain: 0.46, pan: 0.16, reverb: 0.3 },
    kanun: { inst: "kanun", gain: 0.28, pan: 0.36, reverb: 0.28 },
    nay: { inst: "nay", gain: 0.44, pan: 0.06, reverb: 0.4 },
    laouto: {
      inst: "laouto",
      gain: 0.26,
      pan: 0.3,
      reverb: 0.24,
      pattern: {
        a: { kind: "strum", low: 48, high: 64, steps: "D . . d . d ." },
        b: { kind: "strum", low: 48, high: 64, steps: "D . u d u d u" },
        end: { kind: "strum", low: 48, high: 64, steps: "D . . . . . ." },
      },
    },
    darbuka: {
      inst: "perc",
      gain: 0.28,
      pan: 0.1,
      reverb: 0.22,
      pattern: {
        a: { kind: "drum", steps: "D..T.T.", hits: { D: ["darb_doum", 0.72], T: ["darb_tek", 0.5] } },
        soft: { kind: "drum", steps: "D..k.k.", hits: { D: ["darb_doum", 0.6], k: ["darb_ka", 0.42] } },
        b: { kind: "drum", steps: "D.kT.Tk", hits: { D: ["darb_doum", 0.76], T: ["darb_tek", 0.52], k: ["darb_ka", 0.34] } },
      },
    },
    riq: { inst: "perc", gain: 0.2, pan: -0.32, reverb: 0.22, pattern: { kind: "drum", steps: "R.rR.Rr", hits: { R: ["riq", 0.3], r: ["riq", 0.2] } } },
    // 里拉琴弓上的小铃（克里特的 gerakokoudouna）：跟着 3 + 2 + 2 的拍子轻轻地“叮铃”
    bells: { inst: "perc", gain: 0.12, pan: 0.2, reverb: 0.3, pattern: { kind: "drum", steps: "b..b.b.", hits: { b: ["cevgen_tap", 0.4] } } },
    // 衬底（合成）：空五度的持续音、拨奏的低音落在 3 + 2 + 2 的头上
    dem: { inst: "drone", gain: 0.16, pan: -0.2, reverb: 0.4, pattern: { kind: "pad", low: 45, high: 64, size: 2 } },
    bass: { inst: "pizz", gain: 0.28, pan: 0.06, reverb: 0.15, pattern: { kind: "arp", low: 38, steps: "1 . . 5, . 1 .", ring: 2 } },
  },
  sections: {
    taksim: {
      bars: 4,
      chords: "D5 | D5 | D5 | D5",
      lines: {
        tak: "!trem!A4 G F E | !trem!F4 E D z | D E F G A B c | !trem!A7",
        call: "z7 | z4 !bend!A3 | z7 | z3 !vib!d4",
      },
    },
    A: {
      bars: 8,
      chords: "D5 | D5 | D5 | D5 | D5 | C5 | D5 | D5",
      lines: {
        mel: "A,3 D2 {F}E2 | F3 E D G2 | {G}F3 E2 D2 | E5 z2 | F3 G2 A2 | c3 B A G2 | A3 G F E2 | D5 z2",
        // 里拉琴的同一条旋律：上滑、圆滑、回旋音、深揉、句尾往下落
        lyr: "!bend!A,3 D2 {F}E2 | (F3 E) D G2 | {G}F3 (E2 D2) | !vib!E5 z2 | F3 G2 ~A2 | c3 (B A) G2 | A3 (G F) E2 | !fall!D5 z2",
      },
    },
    B: {
      bars: 8,
      chords: "D5 | G5 | D5 | C5 | G5 | C5 | D5 | D5",
      lines: {
        bmel: "a3 g2 ^f2 | g3 ^f _e d2 | ^f3 _e2 d2 | _e5 z2 | d3 c2 B2 | c3 B A G2 | A3 G ^F _E2 | D5 z2",
        blyr: "!bend!a3 g2 ^f2 | g3 {a}^f _e d2 | (^f3 _e2) d2 | !vib!_e5 z2 | d3 (c2 B2) | c3 (B A) G2 | A3 (G ^F) _E2 | !fall!D5 z2",
      },
    },
    coda: {
      bars: 2,
      chords: "D5 | D5",
      lines: { end: "A,3 D2 E2 | D5 z2" },
    },
  },
  forms: [
    [
      { s: "taksim", play: "tak:buzuq call:nay dem", dyn: 0.62 },
      { s: "A", play: "mel:buzuq mel:kanun+12 laouto darbuka dem bass", dyn: 0.66 },
      { s: "A", play: "lyr:lyra+12 laouto bells darbuka.soft dem bass", dyn: 0.66 },
      { s: "B", play: "blyr:lyra bmel:buzuq-12 laouto.b bells darbuka.b riq dem bass", dyn: 0.72 },
      { s: "A", play: "mel:buzuq lyr:lyra+12 mel:nay mel:kanun+12 laouto darbuka riq dem bass", dyn: 0.72, rit: 0.95 },
      { s: "coda", play: "end:buzuq laouto.end dem", dyn: 0.66, rit: 0.88 },
    ],
    [
      { s: "A", play: "lyr:lyra+12 laouto bells darbuka.soft dem bass", dyn: 0.64 },
      { s: "B", play: "bmel:buzuq bmel:nay laouto.b darbuka.b riq dem bass", dyn: 0.7 },
      { s: "A", play: "mel:buzuq lyr:lyra+12 mel:kanun+12 laouto darbuka riq dem bass", dyn: 0.72, rit: 0.95 },
      { s: "coda", play: "end:buzuq laouto.end dem", dyn: 0.66, rit: 0.88 },
    ],
  ],
  rest: [10, 18],
  level: 1.1,
};
