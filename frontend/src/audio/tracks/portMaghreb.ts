// 《萨累的海门》：马格里布的港口与安达卢斯人落脚的城。寰宇世界里放这首的是（势力写 maghreb 或 ottoman_maghreb，见 zones.ts 的 PORT_STYLE_TRACK）：
// 摩洛哥的萨累（布赖格赖格河口的私掠港，海门“拉姆里萨门”通着船坞）与得土安、内陆的非斯，哈夫斯的突尼斯，奥斯曼两个摄政领的阿尔及尔与的黎波里。
// 丹吉尔、休达、马扎甘（葡萄牙）与奥兰（西班牙）是伊比利亚人的驻防城，放伊比利亚的港口曲，所以曲名取萨累（10-11 由《丹吉尔的海门》改名）。
// 地方特色第二阶段新曲：地方乐器领奏（复古合成版的衬底只有合成的持续音与很轻的拨奏，管弦版里换成很轻的管弦；格纳瓦的两段完全不用衬底）。
// D 上、近于多利亚的调（D E F G A B C，下行时常借降 B）；6/8 拍，每分钟 112 拍。港口城里的两种音乐轮流出现：
// - 格纳瓦（从撒哈拉以南来的兄弟会的夜祭音乐）：金布里琴在 D 小五声（D F G A C）上反复弹一句四小节的固定低音，拇指同时拍在骆驼皮上，
//   琴头的铁片“沙沙”地抖；卡拉卡布铁响板打不均匀的三连音（咔 · 嚓 咔 · 嚓），众人拍手；第二段加快、固定低音升高八度、拍手加密；
// - 安达卢斯的“努巴”（格拉纳达陷落以后带到非斯与得土安的宫廷音乐）：拉巴卜领奏，乌德琴低八度、奈伊笛高处异音齐奏（同一条旋律各自加花），
//   达布卡与小框鼓（用里克鼓）打“三拍对两拍”的交替（一小节像 3/4：咚 · 嗒 · 嗒 ·，一小节像 6/8：咚 · · 嗒 · 卡）；
//   句尾常经过下方的 C 落回 D，下行借降 B。
// 和声不用西洋的和弦：努巴只有空五度的持续音（D–A，旋律停在 A 或 G 上时换 A–E、G–D），格纳瓦只有金布里琴自己的低音。
import type { TrackDef } from "../score";

/** 金布里琴的固定低音（四小节，奏两遍）：第一段在最低的八度，第二段往上走。 */
const RIFF_A = "D,,2 D,, z F,, D,, | G,,2 F,, z D,, C,, | D,,2 D,, z F,, G,, | A,,2 G,, F,, D,,2";
const RIFF_B = "D,2 C, A,, z G,, | A,,2 G,, F,, D,,2 | D,2 C, A,, C, D, | F,,2 G,, F,, D,,2";

export const PORT_MAGHREB: TrackDef = {
  id: "port_maghreb",
  title: { zh: "萨累的海门", en: "The Sea Gate of Salé" },
  qpm: 112,
  meter: [6, 8],
  key: "D dorian",
  voices: {
    rabab: { inst: "rabab", gain: 0.56, pan: -0.12, reverb: 0.3 },
    ud: { inst: "ud", gain: 0.5, pan: 0.18, reverb: 0.26 },
    nay: { inst: "nay", gain: 0.42, pan: 0.06, reverb: 0.38 },
    gimbri: { inst: "gimbri", gain: 0.6, pan: -0.04, reverb: 0.2 },
    gslap: { inst: "perc", gain: 0.26, pan: -0.04, reverb: 0.2, pattern: { a: { kind: "drum", steps: "...s.....s.s", hits: { s: ["gimbri_slap", 0.6] } }, b: { kind: "drum", steps: "..s..s..s.ss", hits: { s: ["gimbri_slap", 0.6] } } } },
    qraqeb: {
      inst: "perc",
      gain: 0.24,
      pan: 0.24,
      reverb: 0.24,
      pattern: {
        a: { kind: "drum", steps: "K.sK.sK.sK.s", hits: { K: ["qraqeb", 0.62], s: ["qraqeb_shut", 0.42] } },
        b: { kind: "drum", steps: "K.sKssK.sK.s", hits: { K: ["qraqeb", 0.66], s: ["qraqeb_shut", 0.44] } },
      },
    },
    claps: {
      inst: "perc",
      gain: 0.2,
      pan: -0.28,
      reverb: 0.3,
      pattern: { a: { kind: "drum", steps: "P..P..P..P..", hits: { P: ["tasfiq", 0.45] } }, b: { kind: "drum", steps: "P.PP.PP.PP.P", hits: { P: ["tasfiq", 0.45] } } },
    },
    darb: {
      inst: "perc",
      gain: 0.28,
      pan: 0.1,
      reverb: 0.22,
      pattern: {
        nuba: { kind: "drum", steps: "D.T.T.D..T.k", hits: { D: ["darb_doum", 0.72], T: ["darb_tek", 0.52], k: ["darb_ka", 0.34] } },
        coda: { kind: "drum", steps: "D.T.T.D..T.kD.T.T.D.....", hits: { D: ["darb_doum", 0.75], T: ["darb_tek", 0.52], k: ["darb_ka", 0.34] } },
      },
    },
    tar: {
      inst: "perc",
      gain: 0.22,
      pan: -0.22,
      reverb: 0.24,
      pattern: {
        nuba: { kind: "drum", steps: "D.k.k.D.kTk.", hits: { D: ["riq_dum", 0.6], T: ["riq_tak", 0.5], k: ["riq_ka", 0.32] } },
        coda: { kind: "drum", steps: "D.k.k.D.kTk.D.k.k.S.....", hits: { D: ["riq_dum", 0.6], T: ["riq_tak", 0.5], k: ["riq_ka", 0.32], S: ["riq_sak", 0.6] } },
      },
    },
    // 衬底（合成，只在努巴里）：D–A 的持续音、每小节一下很轻的拨奏
    dem: { inst: "drone", gain: 0.15, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 50, high: 69, size: 2 } },
    bass: { inst: "pizz", gain: 0.2, pan: 0.06, reverb: 0.16, pattern: { kind: "arp", low: 38, steps: "1 . . . . .", ring: 3 } },
  },
  sections: {
    intro: { bars: 2, chords: "D5 | D5", lines: { riff: "D,,2 D,, z F,, D,, | G,,2 F,, z D,, C,," } },
    gnawa: { bars: 8, chords: "D5 | D5 | D5 | D5 | D5 | D5 | D5 | D5", lines: { riff: `${RIFF_A} | ${RIFF_A}` } },
    gnawa2: { bars: 8, chords: "D5 | D5 | D5 | D5 | D5 | D5 | D5 | D5", lines: { riff: `${RIFF_B} | ${RIFF_B}` } },
    nuba: {
      bars: 8,
      chords: "D5 | D5 | D5 | A5 | D5 | D5 | A5 | D5",
      lines: { nb: "D2 E F G A | G2 F {G}F E D | E2 F G2 A | A3 _B A G | D2 E F G A | c2 B A G A | A2 G F E D | E D C !vib!D3" },
    },
    nuba2: {
      bars: 8,
      chords: "A5 | D5 | D5 | G5 | A5 | D5 | A5 | D5",
      lines: { nb2: "A2 B c B A | d2 c B A G | A2 G F E F | G3 F E D | A2 B c d e | f2 e d c B | A2 G F E D | E D C !vib!D3" },
    },
    coda: {
      bars: 4,
      chords: "D5 | D5 | D5 | D5",
      lines: { cd: "A3 c B A | G F E F G2 | F E D C D2 | D6" },
    },
  },
  forms: [
    [
      { s: "intro", play: "riff:gimbri gslap.a", dyn: 0.66 },
      { s: "gnawa", play: "riff:gimbri gslap.a qraqeb.a claps.a", dyn: 0.7 },
      { s: "nuba", play: "nb:rabab nb:ud-12 darb.nuba tar.nuba dem bass", dyn: 0.68 },
      { s: "gnawa2", play: "riff:gimbri gslap.b qraqeb.b claps.b", dyn: 0.74, tempo: 1.06 },
      { s: "nuba2", play: "nb2:rabab nb2:ud-12 nb2:nay darb.nuba tar.nuba dem bass", dyn: 0.72 },
      { s: "coda", play: "cd:rabab cd:ud-12 cd:nay darb.coda tar.coda dem", dyn: 0.72, rit: 0.88 },
    ],
    [
      { s: "nuba", play: "nb:rabab darb.nuba dem bass", dyn: 0.64 },
      { s: "nuba2", play: "nb2:rabab nb2:ud-12 nb2:nay darb.nuba tar.nuba dem bass", dyn: 0.7 },
      { s: "gnawa", play: "riff:gimbri gslap.a qraqeb.a claps.a", dyn: 0.7 },
      { s: "gnawa2", play: "riff:gimbri gslap.b qraqeb.b claps.b", dyn: 0.74, tempo: 1.06 },
      { s: "nuba", play: "nb:rabab nb:ud-12 nb:nay darb.nuba tar.nuba dem bass", dyn: 0.72 },
      { s: "coda", play: "cd:rabab cd:ud-12 cd:nay darb.coda tar.coda dem", dyn: 0.72, rit: 0.88 },
    ],
  ],
  rest: [10, 18],
  level: 1.12,
};
