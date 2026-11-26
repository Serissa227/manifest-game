// 《白城的薄荷茶》：养成篇·家乡的日常——马格里布（塔里克的阿尔及尔，“白色的城”；自创主角里非斯的书香人家）。旋律原创。
// 山坡上一层层的白房子，屋顶平台上晾着毯子，午后的薄荷茶倒得高高的；隔壁的老乐师在练安达卢斯的“萨纳阿”（格拉纳达的乐曲传到阿尔及尔的那一支）。
// D 上的希贾兹（D 降E 升F G A 降B C：降E — 升F 的增二度），4/4（每分钟 88 拍），不急：
// - 引子：卡农琴在 D 的持续音上随手弹一串（像塔克西姆），没有鼓；
// - A：拉巴卜（船形的低音弓弦琴）唱主题——头一小节 D 降E 升F G 是希贾兹的下四音列，第五小节在上方五度（A 降B C D）把它模进一遍，
//   第二遍乌德琴低八度异音齐奏，达布卡与小框鼓（用里克鼓）轻轻地打马克苏姆（咚 嗒 · 嗒 咚 · 嗒 ·）；
// - B：一问一答——奈伊笛在上方的 G、C 上问两小节，拉巴卜与乌德琴落回 D 答两小节；卡农琴分解五度；
// - A″：全体（奈伊笛与拉巴卜同一条旋律、各自加花），尾声落回 D。
// 和声不写西洋的三和弦：只有空五度的持续音（D–A，四级上 G–D，七级上 C–G）。衬底（合成的持续音与很轻的拨奏）管弦版换成很轻的弦乐。
import type { TrackDef } from "../score";

export const UB_HOME_MAGHREB: TrackDef = {
  id: "ub_home_maghreb",
  title: { zh: "白城的薄荷茶" },
  qpm: 88,
  meter: [4, 4],
  key: "D hijaz",
  voices: {
    rabab: { inst: "rabab", gain: 0.58, pan: -0.12, reverb: 0.3 },
    ud: { inst: "ud", gain: 0.5, pan: 0.2, reverb: 0.26 },
    nay: { inst: "nay", gain: 0.44, pan: 0.04, reverb: 0.4 },
    kanun: { inst: "kanun", gain: 0.5, pan: 0.3, reverb: 0.3 },
    kan: { inst: "kanun", gain: 0.2, pan: 0.32, reverb: 0.3, pattern: { kind: "arp", low: 50, steps: "1 5 8 5 12 8 5 8", ring: 2 } },
    darb: {
      inst: "perc",
      gain: 0.26,
      pan: 0.1,
      reverb: 0.22,
      pattern: {
        a: { kind: "drum", steps: "DT.TD.T.", hits: { D: ["darb_doum", 0.6], T: ["darb_tek", 0.42] } },
        s: { kind: "drum", steps: "D...D.T.", hits: { D: ["darb_doum", 0.5], T: ["darb_tek", 0.34] } },
      },
    },
    riq: { inst: "perc", gain: 0.2, pan: -0.24, reverb: 0.26, pattern: { kind: "drum", steps: "k.k.T.k.", hits: { k: ["riq_ka", 0.3], T: ["riq_tak", 0.42] } } },
    // 衬底（合成）：D–A 的持续音、每小节一下很轻的拨奏
    dem: { inst: "drone", gain: 0.14, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 50, high: 69, size: 2 } },
    pz: { inst: "pizz", gain: 0.18, pan: 0.06, reverb: 0.16, pattern: { kind: "arp", low: 38, steps: "1 . . . . . . .", ring: 4 } },
  },
  sections: {
    intro: {
      bars: 2,
      chords: "D5 | D5",
      lines: { tq: "D/2E/2F/2G/2 A/2B/2c/2d/2 c/2B/2A/2G/2 F2 | E/2D/2E/2F/2 G2 F E D2" },
    },
    A: {
      bars: 8,
      chords: "D5 | D5 | G5 | D5 | D5 | C5 | G5 | D5",
      lines: {
        // 下四音列 D 降E 升F G；第五小节在上方五度模进（A 降B C D）
        mel: "D2 E F G3 F | F2 E2 D4 | G2 A B A2 G2 | F3 G F E D2 | A2 B c d3 c | c2 B A G4 | B2 A G F2 E2 | D8",
      },
    },
    B: {
      bars: 8,
      chords: "G5 | G5 | D5 | D5 | C5 | G5 | D5 | D5",
      lines: {
        // 奈伊笛问
        bq: "d3 c B2 A2 | B2 c B A2 G2 | z8 | z8 | c3 d c B A2 | B3 A G4 | z8 | z8",
        // 拉巴卜与乌德琴答
        ba: "z8 | z8 | A2 G F G2 F E | D6 z2 | z8 | z8 | F3 G F E D2 | D8",
      },
    },
    coda: {
      bars: 2,
      chords: "D5 | D5",
      lines: { cd: "F2 E D G2 F E | D8" },
    },
  },
  forms: [
    [
      { s: "intro", play: "tq:kanun dem", dyn: 0.56 },
      { s: "A", play: "mel:rabab dem pz", dyn: 0.6 },
      { s: "A", play: "mel:rabab mel:ud-12 darb.s riq dem pz", dyn: 0.64 },
      { s: "B", play: "bq:nay ba:rabab ba:ud-12 kan darb.s dem", dyn: 0.62 },
      { s: "A", play: "mel:rabab mel:nay mel:ud-12 kan darb.a riq dem pz", dyn: 0.68 },
      { s: "coda", play: "cd:rabab cd:nay cd:ud-12 dem", dyn: 0.6, to: 0.44, rit: 0.84 },
    ],
    [
      { s: "intro", play: "tq:kanun dem", dyn: 0.54 },
      { s: "A", play: "mel:nay mel:ud-12 dem pz", dyn: 0.6 },
      { s: "B", play: "bq:rabab ba:ud-12 kan dem", dyn: 0.6 },
      { s: "A", play: "mel:rabab mel:ud-12 darb.s riq dem pz", dyn: 0.64 },
      { s: "B", play: "bq:nay ba:rabab ba:ud-12 kan darb.s dem", dyn: 0.64 },
      { s: "A", play: "mel:rabab mel:nay mel:ud-12 kan darb.a riq dem pz", dyn: 0.68 },
      { s: "coda", play: "cd:rabab cd:nay cd:ud-12 dem", dyn: 0.6, to: 0.44, rit: 0.84 },
    ],
  ],
  rest: [10, 16],
  level: 1.12,
};
