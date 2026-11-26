// 《橙花码头》：伊比利亚的港口（塞维利亚的阿雷纳尔河岸、里斯本的里贝拉、加的斯、巴伦西亚……橙树、白墙、商人的叫卖与教堂乐手的游行）。
// 第九批配乐·地方特色第二阶段：文艺复兴的伊比利亚乐器领奏（复古合成版的衬底用合成的弦乐与拨奏低音，管弦版换成真的弦乐，都很轻）。
// G 小调，6/8 拍（每分钟 150 个四分音符：附点四分音符一拍 100），写成维兰西科（villancico）的样子：叠句（estribillo）与小节（copla）轮流——
// - 引子：三孔笛与塔博鼓，一个人吹、一个人敲（伊比利亚乡村节日的“一人乐队”）；
// - 叠句：福利亚（folía）一类的低音（g — D — g — F — 降B — F — g — D，第二遍落回 g），六拍子里不时唱成三个四分音符（sesquialtera：6/8 与 3/4 交替）；
//   第一遍是高音与中音竖笛（三度、六度地并行）+ 维韦拉琴的扫弦（rasgueado）+ 巴洪管的低音 + 响板与阿杜菲方鼓；
//   第二遍是塞维利亚大教堂的“乐手”（ministriles）：肖姆管两支 + 萨克布 + 小定音鼓与塔博鼓（户外的“高音乐队”）；最后一遍全体；
// - 小节：罗曼内斯卡（romanesca）的低音（降B — F — g — D），维韦拉琴的变奏（diferencias：八分音符的经过句），维奥尔琴走低音；
//   第二次是三孔笛的变奏（加泰罗尼亚的 flabiol 一类），句子里有降 E — 升 F 的增二度（摩尔人留下的颜色）；
// - 尾声：两小节的“半终止 — 终止”，最后的和弦是 G 大三和弦（皮卡第三度，文艺复兴的结尾）。
// 和声是文艺复兴的三和弦（这一带的音乐本来就是），不用后来的属七与弗拉门戈。旋律原创。
import type { TrackDef } from "../score";

export const PORT_IBERIA: TrackDef = {
  id: "port_iberia",
  title: { zh: "橙花码头", en: "Quay of Orange Blossom" },
  qpm: 150,
  meter: [6, 8],
  key: "G minor",
  voices: {
    pipe: { inst: "pipe", gain: 0.42, pan: 0.16, reverb: 0.3 },
    vihuela: { inst: "vihuela", gain: 0.66, pan: -0.14, reverb: 0.28 },
    vstrum: {
      inst: "vihuela",
      gain: 0.22,
      pan: 0.26,
      reverb: 0.22,
      pattern: {
        a: { kind: "strum", low: 50, high: 69, steps: "D . u D u u" },
        h: { kind: "strum", low: 50, high: 69, steps: "D . D . D ." },
        e: { kind: "strum", low: 50, high: 69, steps: "D . . D . . D . . . . ." },
      },
    },
    recs: { inst: "rec_soprano", gain: 0.42, pan: 0.08, reverb: 0.32 },
    reca: { inst: "rec_alto", gain: 0.36, pan: -0.06, reverb: 0.32 },
    shawm: { inst: "shawm", gain: 0.56, pan: -0.08, reverb: 0.34 },
    shawm2: { inst: "shawm", gain: 0.4, pan: 0.18, reverb: 0.34 },
    sackbut: { inst: "sackbut", gain: 0.4, pan: 0.24, reverb: 0.34 },
    bajon: { inst: "bajon", gain: 0.42, pan: 0.2, reverb: 0.26 },
    // 小节里的低音：维奥尔琴拉罗曼内斯卡的低音（每小节两个附点四分音符：根音、下方五度）
    gamba: { inst: "gamba", gain: 0.36, pan: 0.22, reverb: 0.26, pattern: { kind: "arp", low: 38, steps: "1 . . 5, . ." } },
    taborin: {
      inst: "perc",
      gain: 0.3,
      pan: 0.12,
      reverb: 0.24,
      pattern: {
        a: { kind: "drum", steps: "T.tT.t", hits: { T: ["tambori", 0.62], t: ["tambori_soft", 0.42] } },
        h: { kind: "drum", steps: "T.t.t.", hits: { T: ["tambori", 0.6], t: ["tambori_soft", 0.4] } },
      },
    },
    cast: {
      inst: "perc",
      gain: 0.42,
      pan: 0.3,
      reverb: 0.2,
      pattern: {
        a: { kind: "drum", steps: "R.cC.c", hits: { R: ["castanet_roll", 0.46], c: ["castanet", 0.3], C: ["castanet_lo", 0.42] } },
        e: { kind: "drum", steps: "R..C..R.....", hits: { R: ["castanet_roll", 0.5], C: ["castanet_lo", 0.45] } },
      },
    },
    adufe: {
      inst: "perc",
      gain: 0.36,
      pan: -0.28,
      reverb: 0.24,
      pattern: {
        a: { kind: "drum", steps: "A.ta.t", hits: { A: ["adufe", 0.6], a: ["adufe", 0.36], t: ["adufe_tek", 0.4] } },
        s: { kind: "drum", steps: "a..t..", hits: { a: ["adufe", 0.34], t: ["adufe_tek", 0.26] } },
      },
    },
    nakers: {
      inst: "perc",
      gain: 0.28,
      pan: -0.12,
      reverb: 0.26,
      pattern: {
        a: { kind: "drum", steps: "L..h.h", hits: { L: ["naker_lo", 0.55], h: ["naker_hi", 0.38] } },
        e: { kind: "drum", steps: "L..h..L.....", hits: { L: ["naker_lo", 0.6], h: ["naker_hi", 0.42] } },
      },
    },
    // 衬底（合成）：很轻的弦乐长音与拨奏低音
    pad: { inst: "strings", gain: 0.13, pan: -0.2, reverb: 0.4, pattern: { kind: "pad", low: 55, high: 70, size: 3 } },
    pz: { inst: "pizz", gain: 0.2, pan: 0.06, reverb: 0.15, pattern: { kind: "arp", low: 31, steps: "1 . . 5, . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "Gm | D | Gm | D",
      lines: { call: "d d d g2 d | ^f2 e d2 A | B A G d2 g | ^f6" },
    },
    estribillo: {
      bars: 16,
      chords: "Gm | D | Gm | F | Bb | F | Gm | D | Gm | D | Gm | F | Bb | F | Gm*3 D*3 | Gm",
      lines: {
        mel: "B2 d3 c | A2 ^F2 D2 | G B d g3 | f3 c3 | d2 f3 e | c2 A2 F2 | G2 B3 A | A6 | B2 d3 c | A2 ^F2 D2 | G B d g3 | a3 f2 c | d2 f2 b2 | a3 g f e | d B G A3 | G6",
        // 中音与低音避开与旋律的平行八度、五度（审查后改：第 2→3、10→11 小节不再三个声部一起把 D — A — D 平移成 G — D — G，
        // 低音在第 2 小节下到 D、A 再落 G，第 3 小节后半走降 B，第 4 小节 F 跳八度、第 12 小节后半走 A；
        // 第 7、15 小节的中音也不再走降 E — 升 F 的增二度（增二度只留给小节里三孔笛的那一句）；旋律、和弦与小节分配不变）
        alto: "G2 B3 A | ^F2 D4 | D3 B3 | A6 | B2 d3 c | A2 F2 C2 | B,2 G4 | ^F6 | G2 B3 A | ^F2 D4 | D3 B3 | c3 A2 F | B2 d2 f2 | f3 e d c | B G D ^F3 | D6",
        bass: "G,3 D,3 | D,2 D,,2 A,,2 | G,,3 B,,3 | F,3 F,,3 | B,,3 F,3 | F,2 F,,2 A,,2 | G,,3 E,,3 | D,,6 | G,3 D,3 | D,2 D,,2 A,,2 | G,,3 B,,3 | F,3 A,,3 | B,,3 F,3 | F,2 F,,2 A,,2 | G,,3 D,,3 | G,,6",
      },
    },
    copla: {
      bars: 8,
      chords: "Bb | F | Gm | D | Bb | F | Gm*3 D*3 | Gm",
      lines: {
        // 维韦拉琴的变奏：一串八分音符的经过句，第 7 小节是 降B — A — G — 升F — 降E — D（增二度）
        dif: "d c B c d f | c B A G F A | B A G A B d | A2 ^F G A ^c | d3 f2 d | c3 A2 c | B A G ^F E D | [G,DG]3 z3",
        // 同一段变奏给竖笛（吹奏乐器一次只奏一个音：最后不扫和弦）
        difr: "d c B c d f | c B A G F A | B A G A B d | A2 ^F G A ^c | d3 f2 d | c3 A2 c | B A G ^F E D | G3 z3",
        // 第二次的变奏（三孔笛）：唱成三个四分音符的 3/4，再落回 6/8
        dif2: "f2 d2 B2 | c2 A2 F2 | G2 B2 d2 | ^f3 e d ^c | d2 f2 b2 | a2 f2 c2 | d2 B ^c2 A | G6",
      },
    },
    coda: {
      bars: 2,
      chords: "Gm*3 D*3 | G",
      lines: { end: "d2 B A3 | =B6", endalto: "B2 G ^F3 | G6", endbass: "G,3 D,3 | G,,6" },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:pipe taborin.a", dyn: 0.62 },
      { s: "estribillo", play: "mel:recs+12 alto:reca+12 bass:bajon vstrum.a cast.a adufe.a pz", dyn: 0.66 },
      { s: "copla", play: "dif:vihuela gamba adufe.s pad", dyn: 0.62 },
      { s: "estribillo", play: "mel:shawm alto:shawm2 bass:sackbut nakers.a taborin.a pz", dyn: 0.7 },
      { s: "copla", play: "dif2:pipe+12 vstrum.h gamba taborin.h cast.a pad", dyn: 0.66 },
      { s: "estribillo", play: "mel:shawm alto:shawm2 bass:sackbut bass:bajon vstrum.a cast.a adufe.a nakers.a pad pz", dyn: 0.74, rit: 0.96 },
      { s: "coda", play: "end:shawm endalto:shawm2 endbass:sackbut endbass:bajon vstrum.e cast.e nakers.e pad", dyn: 0.72, rit: 0.84 },
    ],
    [
      { s: "estribillo", play: "mel:vihuela bass:gamba vstrum.a cast.a adufe.a pad", dyn: 0.64 },
      { s: "copla", play: "difr:recs+12 gamba adufe.s pad", dyn: 0.62 },
      { s: "estribillo", play: "mel:shawm alto:shawm2 bass:sackbut bass:bajon nakers.a taborin.a pz", dyn: 0.72, rit: 0.96 },
      { s: "coda", play: "end:shawm endalto:shawm2 endbass:sackbut endbass:bajon vstrum.e nakers.e pad", dyn: 0.7, rit: 0.84 },
    ],
  ],
  rest: [10, 18],
  level: 1.15,
};
