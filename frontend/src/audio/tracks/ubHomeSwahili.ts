// 《珊瑚屋的天井》：养成篇·家乡的日常——斯瓦希里海岸（巴拉卡的基尔瓦）。旋律原创。
// 珊瑚石砌的屋子围着一方天井，木雕的大门开向海；孩子在门槛上弹拇指琴，屋里的大人弹乌德琴跟着哼，海风把祖马里的声音从码头吹过来。
// C 大调（偶尔借降 B：东非海岸的歌常有的降七级），6/8 拍（每分钟 96 个四分音符，附点四分音符一拍 64），三拍对两拍地晃：
// - 引子：拇指琴（铁环沙沙响）一个人转一个小圈，乌德琴吹出养成篇的成长动机（G → C → D → E：5 → 1 → 2 → 3）；
// - A：拇指琴唱一支孩子气的小曲（第五、六小节借降 B 的和弦），底下另一只拇指琴一直转；
//   再一遍乌德琴低八度跟着，卡亚姆巴沙箱与恩戈马鼓（大的姆松多、小的恰普奥）进来；
// - B：祖马里（斯瓦希里海岸的双簧管）唱一段往上扬的，乌德琴低八度，塔里框鼓轻轻地拍；
// - A″：全体，尾声落回 C。
// 衬底（合成的弦乐长音与拨奏低音）很轻，管弦版换成真的弦乐。
import type { TrackDef } from "../score";

export const UB_HOME_SWAHILI: TrackDef = {
  id: "ub_home_swahili",
  title: { zh: "珊瑚屋的天井" },
  qpm: 96,
  meter: [6, 8],
  key: "C major",
  voices: {
    kal: { inst: "kalimba", gain: 0.5, pan: -0.1, reverb: 0.26 },
    kpat: {
      inst: "kalimba",
      gain: 0.26,
      pan: 0.26,
      reverb: 0.24,
      pattern: {
        a: { kind: "arp", low: 55, steps: "1 5 8 5 10 5", ring: 2 },
        b: { kind: "arp", low: 55, steps: "1 . 5 . 8 .", ring: 2 },
      },
    },
    ud: { inst: "ud", gain: 0.54, pan: 0.16, reverb: 0.26 },
    zumari: { inst: "zumari", gain: 0.38, pan: -0.02, reverb: 0.32 },
    ngoma: { inst: "perc", gain: 0.28, pan: 0.06, reverb: 0.22, pattern: { kind: "drum", steps: "M.c.c.", hits: { M: ["msondo", 0.55], c: ["chapuo", 0.38] } } },
    kayamba: { inst: "perc", gain: 0.24, pan: -0.3, reverb: 0.2, pattern: { kind: "drum", steps: "K.kK.k", hits: { K: ["kayamba", 0.46], k: ["kayamba", 0.28] } } },
    tari: { inst: "perc", gain: 0.22, pan: 0.3, reverb: 0.24, pattern: { kind: "drum", steps: "T..t..", hits: { T: ["tari", 0.5], t: ["tari_tek", 0.36] } } },
    // 衬底（合成）：很轻的弦乐长音与拨奏低音
    pad: { inst: "strings", gain: 0.12, pan: -0.22, reverb: 0.42, pattern: { kind: "pad", low: 55, high: 69, size: 3 } },
    pz: { inst: "pizz", gain: 0.2, pan: 0.06, reverb: 0.16, pattern: { kind: "arp", low: 36, steps: "1 . . 5, . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "C | F | C | C",
      // 成长动机：G → C → D → E
      lines: { mot: "z6 | z6 | G,3 C3 | D3 E3" },
    },
    A: {
      bars: 8,
      chords: "C | F | C | G | C | Bb | F | C",
      lines: { mel: "E2 G G2 E | F2 A c2 A | G3 E3 | D2 E D3 | E2 G c2 _B | d2 _B B2 F | A2 G F2 E | C6" },
    },
    B: {
      bars: 8,
      chords: "F | C | F | G | Am | F | G | C",
      lines: { bm: "A2 c c2 A | G2 E G3 | A2 c d2 c | B3 G3 | c2 A c2 e | d2 c A2 F | G2 A B2 d | c6" },
    },
    coda: {
      bars: 2,
      chords: "C | C",
      lines: { cd: "E2 G G2 E | C6" },
    },
  },
  forms: [
    [
      { s: "intro", play: "mot:ud kpat.a pad", dyn: 0.52, to: 0.58 },
      { s: "A", play: "mel:kal kpat.a pad", dyn: 0.6 },
      { s: "A", play: "mel:kal mel:ud-12 kpat.a kayamba ngoma pz", dyn: 0.64 },
      { s: "B", play: "bm:zumari bm:ud-12 kpat.b tari kayamba pad", dyn: 0.62 },
      { s: "B", play: "bm:ud bm:kal kpat.a tari ngoma kayamba pz", dyn: 0.64 },
      { s: "A", play: "mel:kal mel:zumari mel:ud-12 kpat.a ngoma kayamba tari pz pad", dyn: 0.68 },
      { s: "coda", play: "cd:kal cd:ud-12 kpat.b pad", dyn: 0.6, to: 0.44, rit: 0.84 },
    ],
    [
      { s: "A", play: "mel:ud-12 kpat.a pad", dyn: 0.58 },
      { s: "B", play: "bm:kal kpat.b tari pad", dyn: 0.6 },
      { s: "A", play: "mel:kal mel:ud-12 kpat.a kayamba ngoma pz", dyn: 0.64 },
      { s: "B", play: "bm:zumari bm:ud-12 kpat.a tari kayamba pz", dyn: 0.64 },
      { s: "A", play: "mel:kal mel:zumari mel:ud-12 kpat.a ngoma kayamba tari pz pad", dyn: 0.68 },
      { s: "coda", play: "cd:kal cd:ud-12 kpat.b pad", dyn: 0.6, to: 0.44, rit: 0.84 },
    ],
  ],
  rest: [10, 16],
  level: 1.12,
};
