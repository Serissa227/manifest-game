// 《咖啡馆的午后》：奥斯曼的港口与城市（伊斯坦布尔、士麦那、贝鲁特、亚历山大、开罗……）的第二首——码头后面的咖啡馆里，
// 有人抱着坦布尔琴慢慢弹，旁边的人敲着小鼓跟上。与《金角湾的集市》轮着放。第九批 A01（2026-11-11）新写，旋律原创。
// D 上的拉斯特（三级与七级是“中立音”：F 与 C 各偏四分之一音），9/8 拍的“阿克萨克”（aksak：2 + 2 + 2 + 3，最后一拍拖长，像瘸了一下），
// 每分钟 138 个四分音符：
// - 引子（taksim）：坦布尔琴独自弹一段，没有鼓；
// - A：坦布尔琴领奏，一句一小节地往上再落回来，乌德琴在低处拨根音与五度；再来时卡农琴高八度跟着（齐奏里各走各的装饰）；
// - B（meyan，高处的一段）：奈伊笛往上走到高音 D 一带，克曼切跟着齐奏，最后同一个收束落回主音；
// - 最后一遍 A 坦布尔、克曼切、卡农琴一起，达布卡、本迪尔框鼓与里克鼓全上。
// 不写三和弦，只有空五度的持续音；衬底是很轻的持续音与拨奏低音（管弦版换成真的弦乐）。
import type { TrackDef } from "../score";

export const PORT_OTTOMAN_CAFE: TrackDef = {
  id: "port_ottoman_cafe",
  title: { zh: "咖啡馆的午后" },
  qpm: 138,
  meter: [9, 8],
  key: "D rast",
  level: 0.99,
  voices: {
    tanb: { inst: "tanbur", gain: 0.56, pan: -0.14, reverb: 0.3 },
    kanun: { inst: "kanun", gain: 0.32, pan: 0.28, reverb: 0.3 },
    nay: { inst: "nay", gain: 0.5, pan: 0.1, reverb: 0.4 },
    kem: { inst: "kemence", gain: 0.44, pan: -0.24, reverb: 0.34 },
    ud: { inst: "ud", gain: 0.36, pan: 0.2, reverb: 0.26, pattern: { kind: "arp", low: 38, steps: "1 . 5 . 1 . 5 8 .", ring: 2 } },
    // 阿克萨克：咚 · 哒 · 咚 · 哒 哒 ·（2 + 2 + 2 + 3）
    darb: {
      inst: "perc",
      gain: 0.36,
      pan: 0.1,
      reverb: 0.22,
      pattern: {
        a: { kind: "drum", steps: "D.t.D.tt.", hits: { D: ["darb_doum", 0.62], t: ["darb_tek", 0.4] } },
        b: { kind: "drum", steps: "D.tkD.ttk", hits: { D: ["darb_doum", 0.64], t: ["darb_tek", 0.42], k: ["darb_ka", 0.24] } },
      },
    },
    bend: { inst: "perc", gain: 0.26, pan: -0.16, reverb: 0.3, pattern: { kind: "drum", steps: "B.....b..", hits: { B: ["bendir", 0.54], b: ["bendir_tek", 0.3] } } },
    riq: { inst: "perc", gain: 0.22, pan: 0.24, reverb: 0.24, pattern: { kind: "drum", steps: "r.rr.rr.r", hits: { r: ["riq_tak", 0.32] } } },
    // 衬底（合成）
    drone: { inst: "drone", gain: 0.16, pan: -0.2, reverb: 0.42, pattern: { kind: "pad", low: 50, high: 69, size: 2 } },
    pz: { inst: "pizz", gain: 0.18, pan: 0.05, reverb: 0.16, pattern: { kind: "arp", low: 38, steps: "1 . . . . . 5 . .", ring: 2 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "D5 | D5 | D5 | D5",
      lines: { taq: "D9 | D2 E2 F2 G3 | A4 G2 F3 | !vib!D9" },
    },
    A: {
      bars: 8,
      chords: "D5 | D5 | G5 | D5 | A5 | G5 | A5 | D5",
      lines: {
        mel: "D2 E2 F2 G3 | A2 G F G2 A3 | B2 A2 G2 A3 | G2 F2 E2 D3 | A2 B2 c2 d3 | d2 c B c2 B3 | A2 B A G2 E3 | F2 E2 D5",
      },
    },
    B: {
      bars: 8,
      chords: "D5 | D5 | A5 | A5 | G5 | G5 | A5 | D5",
      lines: {
        bmel: "d2 e2 f2 g3 | a2 g2 f2 e3 | e2 f e d2 e3 | c2 d2 e2 c3 | d2 c2 B2 c3 | B2 A2 G2 B3 | A2 c B A2 G3 | F2 E2 D5",
      },
    },
    outro: {
      bars: 2,
      chords: "A5 | D5",
      lines: { tag: "A2 G2 F2 E3 | D9" },
    },
  },
  forms: [
    [
      { s: "intro", play: "taq:tanb drone", dyn: 0.52, to: 0.58 },
      { s: "A", play: "mel:tanb ud darb.a pz", dyn: 0.64 },
      { s: "A", play: "mel:tanb mel:kanun+12 ud darb.a riq drone pz", dyn: 0.68 },
      { s: "B", play: "bmel:nay bmel:kem ud darb.b bend drone pz", dyn: 0.68, to: 0.72 },
      { s: "A", play: "mel:tanb mel:kem mel:kanun+12 ud darb.b bend riq drone pz", dyn: 0.74 },
      { s: "outro", play: "tag:tanb ud drone", dyn: 0.6, to: 0.44, rit: 0.84 },
    ],
    [
      { s: "intro", play: "taq:tanb drone", dyn: 0.52, to: 0.58 },
      { s: "A", play: "mel:tanb ud darb.a pz", dyn: 0.62 },
      { s: "B", play: "bmel:nay ud darb.a riq drone pz", dyn: 0.66 },
      { s: "B", play: "bmel:nay bmel:kem bmel:kanun ud darb.b bend riq drone pz", dyn: 0.7, to: 0.72 },
      { s: "A", play: "mel:tanb mel:kem mel:kanun+12 ud darb.b bend riq drone pz", dyn: 0.74 },
      { s: "outro", play: "tag:tanb ud drone", dyn: 0.6, to: 0.44, rit: 0.84 },
    ],
  ],
  rest: [10, 18],
};
