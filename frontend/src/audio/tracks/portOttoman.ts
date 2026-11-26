// 《金角湾的集市》：奥斯曼的港口（伊斯坦布尔的金角湾、士麦那、贝鲁特、亚历山大……白天的集市与咖啡馆）。
// 地方特色第一阶段重编：地方乐器领奏（复古合成版的衬底用合成的持续音与拨奏低音）。
// 希贾兹木卡姆（A 降B 升C D E F G：降 B 与升 C 之间的增二度），8/8 的杜耶克乌苏尔（咚 嗒 · 嗒 咚 · 嗒 ·，击点在第 1、2、4、5、7 个八分音符；
// 记成 4/4 的一小节），每分钟 100 拍；
// 写成佩什雷夫的样子——几段“哈内”之间夹着同一段“泰斯利姆”（叠句）：
// - 引子：奈伊笛的塔克西姆（即兴的引子：从下面推上来的长音、慢而深的揉音），卡农琴几串碎的上下行，下面只有 A–E 的持续音；
// - 哈内一：乌德琴（低八度）与卡农琴异音齐奏，库都姆打杜耶克；
// - 泰斯利姆：全体齐奏（乌德琴、卡农琴、奈伊笛、高八度的克曼切），本迪尔框鼓与铃鼓加进来；
// - 哈内二：克曼切在高处唱（第二遍换成祖尔纳与达乌尔大鼓——集市上的户外乐队），再回到泰斯利姆。
// 和声不用西洋的和弦进行：只有空五度的持续音（A–E、D–A、G–D），像土耳其古典音乐里的“dem”。
import type { TrackDef } from "../score";

export const PORT_OTTOMAN: TrackDef = {
  id: "port_ottoman",
  title: { zh: "金角湾的集市", en: "Bazaar on the Golden Horn" },
  qpm: 100,
  meter: [4, 4],
  key: "A hijaz",
  voices: {
    ud: { inst: "ud", gain: 0.62, pan: -0.14, reverb: 0.24 },
    kanun: { inst: "kanun", gain: 0.4, pan: 0.3, reverb: 0.26 },
    nay: { inst: "nay", gain: 0.5, pan: 0.14, reverb: 0.38 },
    kemence: { inst: "kemence", gain: 0.44, pan: 0.22, reverb: 0.3 },
    zurna: { inst: "zurna", gain: 0.34, pan: -0.06, reverb: 0.3 },
    // 杜耶克：咚 嗒 · 嗒 咚 · 嗒 ·（库都姆的大鼓“咚”、小鼓“嗒”；达乌尔同一副骨架，大槌“咚”、细棍“嗒”）
    kudum: { inst: "perc", gain: 0.3, pan: 0.08, reverb: 0.22, pattern: { kind: "drum", steps: "Dt.tD.t.", hits: { D: ["kudum_dum", 0.8], t: ["kudum_tek", 0.6] } } },
    bendir: { inst: "perc", gain: 0.3, pan: -0.16, reverb: 0.3, pattern: { kind: "drum", steps: "B.......B..b..t.", hits: { B: ["bendir", 0.7], b: ["bendir", 0.45], t: ["bendir_tek", 0.5] } } },
    riq: { inst: "perc", gain: 0.24, pan: -0.3, reverb: 0.22, pattern: { kind: "drum", steps: ".r.r.r.r", hits: { r: ["riq", 0.26] } } },
    davul: { inst: "perc", gain: 0.3, pan: 0.04, reverb: 0.28, pattern: { kind: "drum", steps: "Dt.tD.t.", hits: { D: ["davul_dum", 0.75], t: ["davul_tek", 0.55] } } },
    // 衬底（合成）：空五度的持续音、拨奏的低音落在“咚”上
    dem: { inst: "drone", gain: 0.18, pan: -0.2, reverb: 0.4, pattern: { kind: "pad", low: 45, high: 64, size: 2 } },
    bass: { inst: "pizz", gain: 0.3, pan: 0.06, reverb: 0.15, pattern: { kind: "arp", low: 33, steps: "1 . . . 1 . . .", ring: 2 } },
  },
  sections: {
    taksim: {
      bars: 4,
      chords: "A5 | A5 | A5 | A5",
      lines: {
        call: "!bend!A4 B2 A2 | c4 {d}c B !vib!A2 | A4 z2 E2 | !bend!A8",
        gliss: "z4 a/2g/2f/2e/2 d c | z8 | z4 e/2f/2g/2a/2 b a | z8",
      },
    },
    hane1: {
      bars: 8,
      chords: "A5 | A5 | A5 | A5 | D5 | G5 | A5 | A5",
      lines: { mel: "A2 B c d2 e2 | f e d c B2 A2 | c d e f g f e d | !slide!e6 z2 | a2 g f e2 d c | d e f d c2 B2 | B c B A G2 B c | A8" },
    },
    teslim: {
      bars: 4,
      chords: "D5 | A5 | G5 | A5",
      lines: { ref: "d2 d e f2 e d | e2 f g a4 | g f e d c B c d | A6 z2" },
    },
    hane2: {
      bars: 8,
      chords: "A5 | D5 | G5 | A5 | A5 | D5 | A5 | A5",
      lines: { bmel: "a2 b c' d'2 c' b | a g f e !vib!f4 | g2 f e d2 c d | !slide!e6 z2 | a2 g a b2 a g | f e f g !vib!a4 | g f e d c B A G | A6 z2" },
    },
    coda: {
      bars: 2,
      chords: "A5 | A5",
      lines: { end: "[A,,E,A,]2 z2 A,2 z2 | z8" },
    },
  },
  forms: [
    [
      { s: "taksim", play: "call:nay gliss:kanun dem", dyn: 0.6 },
      { s: "hane1", play: "mel:ud-12 mel:kanun kudum dem bass", dyn: 0.66 },
      { s: "teslim", play: "ref:ud-12 ref:kanun ref:nay ref:kemence+12 kudum bendir riq dem bass", dyn: 0.72 },
      { s: "hane2", play: "bmel:kemence bmel:kanun-12 kudum dem bass", dyn: 0.68 },
      { s: "teslim", play: "ref:ud-12 ref:kanun ref:nay ref:kemence+12 kudum bendir riq dem bass", dyn: 0.72, rit: 0.94 },
      { s: "coda", play: "end:ud dem", dyn: 0.7, rit: 0.9 },
    ],
    [
      { s: "hane1", play: "mel:nay mel:ud-12 kudum dem bass", dyn: 0.64 },
      { s: "hane2", play: "bmel:zurna-12 davul bendir dem bass", dyn: 0.72 },
      { s: "teslim", play: "ref:ud-12 ref:kanun ref:zurna ref:kemence+12 davul bendir riq dem bass", dyn: 0.74, rit: 0.94 },
      { s: "coda", play: "end:ud dem", dyn: 0.7, rit: 0.9 },
    ],
  ],
  rest: [10, 18],
  level: 1.12,
};
